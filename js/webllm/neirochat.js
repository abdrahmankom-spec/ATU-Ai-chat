/**
 * ИИ-чат для АТУ Портал
 * Использует WebLLM (Phi-2) + RAG (embeddings) для ответов
 */
(function() {
  'use strict';

  // Константы
  const KEY_USERS = 'atu_db_users';
  const KEY_CURRENT = 'atu_current_user';
  const TEXT_MODEL_ID = 'Phi2-q4f32_1-1k';
  const MODEL_LABEL = 'Phi-2 (4-bit, 1k контекст)';
  const MAX_TOKENS = 50;
  const MAX_RAG_SNIPPET = 150;
  const MAX_USER_CONTEXT_CHARS = 100;
  const MAX_QUESTION_CHARS = 200;
  const MAX_TOTAL_PROMPT_CHARS = 400;
  const SYSTEM_MESSAGE = 'Ты ассистент портала АТУ. ВАЖНО: Отвечай ТОЛЬКО на русском языке. Отвечай коротко, 1-2 предложения. Не повторяй вопрос. Не генерируй мусор.';
  const QUESTION_KEYWORDS = ['что', 'как', 'почему', 'зачем', 'где', 'кто', 'когда', 'сколько', 'какой', 'какая', 'какие', 'какую', 'куда', 'можно ли', 'есть ли', 'нужно ли', 'объясни', 'расскажи'];
  const GARBAGE_PATTERNS = [
    /Выведите на экран[^.]*\./gi,
    /Количество строк в статье[^.]*\./gi,
    /Предложение не[^.]*\./gi,
    /не менее повторяющихся[^.]*\./gi,
    /в виде открытых строк[^.]*\./gi,
    /не найдено в виде[^.]*\./gi,
    /The translation of the text is:/gi,
    /I am the translation/gi,
  ];

  // DOM элементы
  const chat = document.querySelector('.ai-chat');
  if (!chat) return;

  const log = document.getElementById('ai-chat-log');
  const statusEl = document.getElementById('ai-chat-status');
  const form = document.getElementById('ai-chat-form');
  const input = document.getElementById('ai-chat-input');
  const sendBtn = chat.querySelector('.ai-chat__send');
  const toggleBtn = document.getElementById('ai-chat-close-btn');
  const openBtn = document.getElementById('ai-chat-open-btn');
  const ragToggle = document.getElementById('ai-chat-rag-toggle');

  // Состояние
  let contextText = '';
  let embeddingsPipeline = null;
  let textGenEngine = null;
  let webllmInitPromise = null;
  let busy = false;
  let ragEnabled = true;
  let contextChunks = [];
  let pendingCommand = null;

  // Утилиты
  function setStatus(message) {
    if (statusEl) statusEl.textContent = message;
  }

  function appendMessage(text, role = 'assistant', withButtons = false, commandType = null) {
    if (!log) return;
    const bubble = document.createElement('div');
    bubble.className = `ai-chat__message ${role === 'user' ? 'ai-chat__message--user' : ''}`;
    
    const textDiv = document.createElement('div');
    textDiv.textContent = text;
    bubble.appendChild(textDiv);
    
    if (withButtons && commandType) {
      const buttonsDiv = document.createElement('div');
      buttonsDiv.className = 'ai-chat__buttons';
      
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '✅ Да';
      confirmBtn.className = 'ai-chat__button';
      confirmBtn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
      confirmBtn.style.color = 'white';
      confirmBtn.onclick = () => executeCommand(commandType);
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '❌ Нет';
      cancelBtn.className = 'ai-chat__button';
      cancelBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      cancelBtn.style.color = 'rgba(255, 255, 255, 0.9)';
      cancelBtn.onclick = () => {
        appendMessage('❌ Действие отменено.', 'assistant');
        pendingCommand = null;
      };
      
      buttonsDiv.appendChild(confirmBtn);
      buttonsDiv.appendChild(cancelBtn);
      bubble.appendChild(buttonsDiv);
    }
    
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
  }

  function executeCommand(commandType) {
    console.log('🔧 Executing command:', commandType);
    pendingCommand = null;
    
    const commands = {
      clear: () => {
        localStorage.clear();
        indexedDB.databases().then(dbs => {
          dbs.forEach(db => indexedDB.deleteDatabase(db.name));
        });
        appendMessage('✅ Хранилище очищено. Страница будет перезагружена через 1 секунду.', 'assistant');
        setTimeout(() => location.reload(), 1000);
      },
      reload: () => {
        appendMessage('✅ Страница будет перезагружена через 1 секунду.', 'assistant');
        setTimeout(() => location.reload(), 1000);
      },
      dashboard: () => {
        appendMessage('✅ Переход на страницу Дашборда...', 'assistant');
        setTimeout(() => window.location.href = 'pages/floor-6.html', 300);
      },
      library: () => {
        appendMessage('✅ Переход на страницу Библиотеки...', 'assistant');
        setTimeout(() => window.location.href = 'pages/floor-5.html', 300);
      },
      profile: () => {
        appendMessage('✅ Переход в Личный кабинет...', 'assistant');
        setTimeout(() => window.location.href = 'pages/floor-1.html', 300);
      }
    };
    
    if (commands[commandType]) {
      commands[commandType]();
    }
  }

  function getUserContext() {
    try {
      const currentRaw = localStorage.getItem(KEY_CURRENT);
      if (!currentRaw) return 'Пользователь: гость.';
      
      let current;
      try {
        current = JSON.parse(currentRaw);
        current = current?.name || current || 'гость';
      } catch {
        current = String(currentRaw || 'гость');
      }
      
      const usersRaw = localStorage.getItem(KEY_USERS);
      if (!usersRaw) return `Пользователь: ${current}.`;
      
      const userList = JSON.parse(usersRaw);
      const user = Array.isArray(userList) ? userList.find(u => u?.name === current) : null;
      if (!user) return `Пользователь: ${current}.`;
      
      const floorLabel = document.querySelector('.elev-floor-label');
      const floorText = floorLabel?.textContent?.trim() || 'не определён';
      
      return [
        `Имя: ${user.name || 'не указано'}`,
        `Группа: ${user.group || 'не назначена'}`,
        `Программа: ${user.program || 'не задана'}`,
        `Активный этаж лифта: ${floorText}`
      ].join('\n');
    } catch (err) {
      console.warn('getUserContext error:', err);
      return 'Пользователь: гость.';
    }
  }

  // RAG функции
  function extractKeywords(text) {
    return Array.from(
      new Set(
        text.toLowerCase()
          .replace(/[^a-zа-я0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(word => word.length >= 4 && word.length <= 18)
      )
    ).slice(0, 60);
  }

  function chunkSectionBody(body) {
    const paragraphs = body.split(/\n{2,}/);
    const chunks = [];
    let buffer = '';
    
    paragraphs.forEach(par => {
      const text = par.trim();
      if (!text) return;
      const candidate = buffer ? `${buffer}\n${text}` : text;
      if (candidate.length > 700) {
        if (buffer) chunks.push(buffer);
        buffer = text;
      } else {
        buffer = candidate;
      }
    });
    if (buffer) chunks.push(buffer);
    return chunks;
  }

  function buildContextIndex(rawText) {
    const sections = [];
    if (!rawText || typeof rawText !== 'string') return sections;
    
    const blockRegex = /✦([^◈]+)◈/gs;
    let blockMatch;
    const blockMap = new Map();
    
    while ((blockMatch = blockRegex.exec(rawText)) !== null) {
      const fullBlock = blockMatch[0];
      const blockContent = blockMatch[1].trim();
      if (!blockContent) continue;
      
      const lines = blockContent.split('\n');
      const title = lines[0]?.trim() || 'Блок';
      const body = lines.slice(1).join('\n').trim();
      
      if (body.length < 20) continue;
      
      const cleaned = body.replace(/\s+/g, ' ').trim();
      if (cleaned.length < 30) continue;
      
      blockMap.set(title, fullBlock);
      blockMap.set(title.split(':')[0], fullBlock);
      
      sections.push({
        id: `block_${title}`,
        title,
        text: cleaned,
        fullBlock,
        lower: cleaned.toLowerCase(),
        keywords: extractKeywords(cleaned),
        embeddingPromise: null,
        embedding: null
      });
    }
    
    window.contextBlockMap = blockMap;
    
    if (!sections.length) {
      const sectionRegex = /={10,}\s*\n([^\n]+)\n={10,}\s*\n([\s\S]*?)(?=(?:={10,}\s*\n[^\n]+\n={10,}\s*\n)|$)/g;
      let match;
      while ((match = sectionRegex.exec(rawText)) !== null) {
        const title = (match[1] || 'Раздел').trim();
        const body = (match[2] || '').trim();
        if (!body) continue;
        const chunkTexts = chunkSectionBody(body);
        chunkTexts.forEach((chunkText, idx) => {
          const cleaned = chunkText.replace(/\s+/g, ' ').trim();
          if (cleaned.length < 80) return;
          sections.push({
            id: `${title}#${idx}`,
            title,
            text: cleaned.slice(0, MAX_RAG_SNIPPET),
            fullBlock: null,
            lower: cleaned.toLowerCase(),
            keywords: extractKeywords(cleaned),
            embeddingPromise: null,
            embedding: null
          });
        });
      }
    }
    
    if (!sections.length) {
      const fallback = rawText.slice(0, MAX_RAG_SNIPPET);
      sections.push({
        id: 'fallback',
        title: 'Контекст',
        text: fallback,
        fullBlock: null,
        lower: fallback.toLowerCase(),
        keywords: extractKeywords(fallback),
        embeddingPromise: null,
        embedding: null
      });
    }
    
    console.log('Context indexed into chunks:', sections.length);
    return sections;
  }

  function selectCandidateChunks(question, limit = 8) {
    if (!contextChunks.length) return [];
    const normalized = question.toLowerCase();
    const words = Array.from(
      new Set(
        normalized.replace(/[^a-zа-я0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
      )
    );
    
    const scored = contextChunks.map(chunk => {
      let score = 0;
      words.forEach(word => {
        if (word.length >= 4 && chunk.keywords.includes(word)) score += 1.5;
        if (chunk.title.toLowerCase().includes(word)) score += 2;
      });
      if (chunk.lower.includes(normalized.slice(0, Math.min(normalized.length, 30)))) {
        score += 1;
      }
      return { chunk, score };
    }).filter(entry => entry.score > 0);
    
    if (!scored.length) {
      return contextChunks.slice(0, Math.min(limit, contextChunks.length));
    }
    
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(entry => entry.chunk);
  }

  async function embedText(text) {
    if (!embeddingsPipeline) throw new Error('Embeddings pipeline отсутствует');
    const output = await embeddingsPipeline(text, {
      pooling: 'mean',
      normalize: true
    });
    return Array.from(output.data || output);
  }

  async function getChunkEmbedding(chunk) {
    if (chunk.embedding) return chunk.embedding;
    if (!chunk.embeddingPromise) {
      chunk.embeddingPromise = embedText(chunk.text).then(vec => {
        chunk.embedding = vec;
        return vec;
      });
    }
    return chunk.embeddingPromise;
  }

  function cosineSimilarity(vecA, vecB) {
    const len = Math.min(vecA.length, vecB.length);
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += vecA[i] * vecB[i];
    }
    return sum;
  }

  function extractAnswerFromBlock(blockText) {
    if (!blockText) return null;
    
    let answer = blockText
      .replace(/^✦[^\n:]+:?\s*/m, '')
      .replace(/◈\s*$/, '')
      .trim();
    
    if (!answer || answer.length < 20) return null;
    
    answer = answer
      .replace(/^-\s*/gm, '')
      .replace(/^\d+\.\s*/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/`[^`]+`/g, '')
      .trim();
    
    const lines = answer.split('\n').filter(line => line.trim().length > 5);
    if (lines.length > 1) {
      answer = lines
        .map(line => line.trim())
        .filter(line => !line.match(/^[А-ЯЁA-Z\s]+$/))
        .join('. ')
        .replace(/\.\s*\./g, '.')
        .trim();
    }
    
    const sentences = answer.split(/[.!?]+\s+/).filter(s => {
      const trimmed = s.trim();
      return trimmed.length > 10 && !trimmed.match(/^[А-ЯЁA-Z\s]+$/);
    });
    
    if (sentences.length > 0) {
      answer = sentences.slice(0, 3).join('. ').trim();
      if (!answer.endsWith('.') && !answer.endsWith('!') && !answer.endsWith('?')) {
        answer += '.';
      }
    }
    
    if (answer.length > 300) {
      answer = answer.substring(0, 300).trim();
      const lastDot = answer.lastIndexOf('.');
      if (lastDot > 200) {
        answer = answer.substring(0, lastDot + 1);
      }
    }
    
    if (answer.length < 20 || /^[А-ЯЁA-Z\s]+$/.test(answer)) return null;
    return answer;
  }

  async function findRelevantContext(question, context, maxChunks = 3) {
    if (!embeddingsPipeline) {
      console.warn('Embeddings модель не загружена, используем начало контекста');
      return { snippet: context.substring(0, 800), hasMatches: true, bestScore: 1, readyAnswer: null };
    }
    
    if (!contextChunks.length && context) {
      contextChunks = buildContextIndex(context);
    }
    
    const candidates = selectCandidateChunks(question, 8);
    if (!candidates.length) {
      return { snippet: '', hasMatches: false, bestScore: 0, readyAnswer: null };
    }
    
    try {
      const questionVec = await embedText(question);
      const similarities = [];
      
      for (const chunk of candidates) {
        const chunkVec = await getChunkEmbedding(chunk);
        const similarity = cosineSimilarity(questionVec, chunkVec);
        similarities.push({ chunk, similarity });
      }
      
      similarities.sort((a, b) => b.similarity - a.similarity);
      const relevantChunks = similarities
        .filter(item => item.similarity > 0.18)
        .slice(0, maxChunks);
      const selected = relevantChunks.length ? relevantChunks : similarities.slice(0, 1);
      
      let readyAnswer = null;
      if (selected.length > 0 && selected[0].similarity > 0.2) {
        const bestChunk = selected[0].chunk;
        console.log('🔍 Trying to extract answer from chunk:', bestChunk.title, 'similarity:', selected[0].similarity);
        
        let extractedAnswer = null;
        
        if (bestChunk.fullBlock) {
          extractedAnswer = extractAnswerFromBlock(bestChunk.fullBlock);
        }
        
        if (!extractedAnswer && window.contextBlockMap) {
          const blockFromMap = window.contextBlockMap.get(bestChunk.title) || 
                               window.contextBlockMap.get(bestChunk.title.split(':')[0]);
          if (blockFromMap) {
            extractedAnswer = extractAnswerFromBlock(blockFromMap);
          }
        }
        
        if (!extractedAnswer) {
          const titleEscaped = bestChunk.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const blockRegex = new RegExp(`✦[^◈]*${titleEscaped}[^◈]*◈`, 's');
          const blockMatch = context.match(blockRegex);
          if (blockMatch) {
            extractedAnswer = extractAnswerFromBlock(blockMatch[0]);
          } else {
            const shortTitle = bestChunk.title.split(':')[0];
            if (shortTitle && shortTitle !== bestChunk.title) {
              const shortEscaped = shortTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const flexibleRegex = new RegExp(`✦[^◈]*${shortEscaped}[^◈]*◈`, 's');
              const flexibleMatch = context.match(flexibleRegex);
              if (flexibleMatch) {
                extractedAnswer = extractAnswerFromBlock(flexibleMatch[0]);
              }
            }
          }
        }
        
        if (!extractedAnswer && bestChunk.text && bestChunk.text.length > 50) {
          extractedAnswer = bestChunk.text
            .replace(/^-\s*/gm, '')
            .replace(/\n/g, '. ')
            .replace(/\.\s*\./g, '.')
            .trim();
          if (extractedAnswer.length > 300) {
            extractedAnswer = extractedAnswer.substring(0, 300);
            const lastDot = extractedAnswer.lastIndexOf('.');
            if (lastDot > 200) extractedAnswer = extractedAnswer.substring(0, lastDot + 1);
          }
          if (extractedAnswer.length < 20) extractedAnswer = null;
        }
        
        if (extractedAnswer) {
          readyAnswer = extractedAnswer;
          console.log('✅✅✅ RAG нашел готовый ответ:', readyAnswer.substring(0, 150));
        }
      }
      
      let snippet = selected
        .map(item => `[${item.chunk.title}]\n${item.chunk.text}`)
        .join('\n\n');
      
      if (snippet.length > MAX_RAG_SNIPPET) {
        snippet = snippet.slice(0, MAX_RAG_SNIPPET);
        const lastSpace = snippet.lastIndexOf(' ');
        if (lastSpace > MAX_RAG_SNIPPET * 0.8) {
          snippet = snippet.slice(0, lastSpace);
        }
      }
      
      return {
        snippet,
        hasMatches: selected.length > 0,
        bestScore: selected[0]?.similarity || 0,
        readyAnswer
      };
    } catch (err) {
      console.warn('⚠️ Embeddings search failed, using fallback:', err.message);
      return { snippet: context.substring(0, 600), hasMatches: false, bestScore: 0, readyAnswer: null };
    }
  }

  // WebLLM функции
  async function verifyWebGPU() {
    if (!navigator.gpu) {
      setStatus('WebGPU не поддерживается этим браузером');
      return false;
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      setStatus('Адаптер недоступен');
      return false;
    }
    return true;
  }

  async function initWebLLMEngine() {
    if (textGenEngine) return textGenEngine;
    if (webllmInitPromise) return webllmInitPromise;
    
    const webllm = window.webllm;
    const CreateEngine = window.CreateEngine;
    const MLCEngine = window.MLCEngine;
    
    if (!webllm) {
      const error = 'WebLLM не загружен. Обновите страницу и подождите загрузки модулей.';
      console.error('❌', error);
      setStatus(error);
      throw new Error(error);
    }
    
    if (!(await verifyWebGPU())) {
      console.error('❌ WebGPU verification failed');
      return;
    }
    
    setStatus(`Загружаю WebLLM (${MODEL_LABEL})...`);
    console.log(`📦 Starting model load: ${TEXT_MODEL_ID}`);
    
    webllmInitPromise = (async () => {
      try {
        let engine;
        
        if (CreateEngine && typeof CreateEngine === 'function') {
          console.log('✅ Using CreateEngine API');
          const prebuilt = webllm.prebuiltAppConfig;
          
          if (!prebuilt?.model_list) {
            throw new Error('prebuiltAppConfig не найден');
          }
          
          const modelList = prebuilt.model_list.filter(item => item.model_id === TEXT_MODEL_ID);
          console.log(`Found ${modelList.length} matching models for ${TEXT_MODEL_ID}`);
          
          if (modelList.length === 0) {
            console.warn('⚠️ Model not in prebuilt list!');
            throw new Error(`Модель ${TEXT_MODEL_ID} не найдена в списке доступных моделей.`);
          }
          
          engine = await CreateEngine(TEXT_MODEL_ID, {
            initProgressCallback: (report) => {
              const percent = report?.progress ? Math.round(report.progress * 100) : 0;
              const stage = report?.text || 'инициализация';
              setStatus(`WebLLM ${percent}% • ${stage}`);
            },
            appConfig: {
              useIndexedDBCache: true,
              model_list: modelList
            }
          });
          console.log('✅ Engine created via CreateEngine');
        } else if (MLCEngine && typeof MLCEngine === 'function') {
          console.log('✅ Using MLCEngine API');
          engine = new MLCEngine();
          engine.setInitProgressCallback((report) => {
            setStatus(report?.text || 'Инициализация...');
          });
          await engine.reload(TEXT_MODEL_ID, {
            temperature: 0.8,
            top_p: 1,
          });
          console.log('✅ Engine created via MLCEngine');
        } else {
          throw new Error('Ни CreateEngine, ни MLCEngine не доступны');
        }
        
        if (!engine) {
          throw new Error('Движок не был создан');
        }
        
        textGenEngine = engine;
        console.log('✅✅✅ WebLLM engine ready!');
        console.log('Engine details:', {
          hasChat: !!(engine?.chat),
          hasCompletions: !!(engine?.chat?.completions),
          engineType: typeof engine,
          engineKeys: engine ? Object.keys(engine).slice(0, 10) : []
        });
        setStatus('Модель готова!');
        return engine;
      } catch (err) {
        console.error('❌❌❌ Failed to init WebLLM:', err);
        setStatus(`Ошибка: ${err.message || String(err)}`);
        throw err;
      } finally {
        webllmInitPromise = null;
      }
    })();
    
    return webllmInitPromise;
  }

  async function runWebLLMCompletion(userPrompt) {
    if (!textGenEngine) {
      await initWebLLMEngine();
    }
    if (!textGenEngine?.chat?.completions) {
      throw new Error('WebLLM движок недоступен.');
    }
    
    // Нейросеть получает ТОЛЬКО системное сообщение + чистый вопрос пользователя
    // RAG подсказки НЕ передаются!
    const stream = await textGenEngine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_MESSAGE },
        { role: 'user', content: userPrompt } // Только вопрос, без RAG!
      ],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: MAX_TOKENS,
      stream: true,
      stream_options: { include_usage: true }
    });
    
    let fullContent = '';
    for await (const chunk of stream) {
      const deltaContent = chunk.choices[0]?.delta?.content || '';
      if (deltaContent) {
        fullContent += deltaContent;
      }
    }
    
    return {
      choices: [{
        message: {
          content: fullContent
        }
      }]
    };
  }

  // Обработка вопросов
  function looksLikeQuestion(text) {
    if (!text?.trim()) return false;
    const trimmed = text.trim();
    if (trimmed.includes('?')) return true;
    const lower = trimmed.toLowerCase();
    return QUESTION_KEYWORDS.some(keyword => {
      if (lower === keyword) return true;
      if (lower.startsWith(keyword + ' ')) return true;
      if (lower.includes(' ' + keyword + ' ')) return true;
      return false;
    });
  }

  function isSimpleGreeting(text) {
    if (!text) return false;
    const trimmed = text.trim().toLowerCase();
    const greetings = ['привет', 'здравствуй', 'здравствуйте', 'hi', 'hello', 'hey', 'салют', 'добрый день', 'добрый вечер', 'доброе утро', 'доброй ночи'];
    return greetings.some(g => trimmed === g || trimmed.startsWith(g + ' ') || trimmed.startsWith(g + '!') || trimmed.startsWith(g + '?'));
  }

  function handleSimpleGreeting(text) {
    const trimmed = text.trim().toLowerCase();
    if (trimmed.includes('привет') || trimmed.includes('hi') || trimmed.includes('hello') || trimmed.includes('hey') || trimmed.includes('салют')) {
      return 'Привет! 👋 Чем могу помочь?';
    }
    if (trimmed.includes('здравствуй') || trimmed.includes('здравствуйте')) {
      return 'Здравствуйте! Чем могу помочь?';
    }
    if (trimmed.includes('добрый день') || trimmed.includes('добрый вечер') || trimmed.includes('доброе утро')) {
      return 'Добрый день! Чем могу помочь?';
    }
    return 'Привет! Чем могу помочь?';
  }

  function processCommand(text) {
    const trimmed = text.trim().toLowerCase();
    
    // Обработка подтверждений
    if (pendingCommand) {
      const confirm = ['да', 'yes', 'подтверждаю', 'ок', 'ok', '✓', 'y'];
      const cancel = ['нет', 'no', 'отмена', 'cancel', '✗', 'n'];
      
      if (confirm.includes(trimmed)) {
        executeCommand(pendingCommand);
        return null;
      }
      if (cancel.includes(trimmed)) {
        appendMessage('❌ Действие отменено.', 'assistant');
        pendingCommand = null;
        return null;
      }
    }
    
    // Команды работают ТОЛЬКО с префиксом "/"
    if (!trimmed.startsWith('/')) {
      return null;
    }
    
    const cmd = trimmed.slice(1).trim();
    if (!cmd) {
      const helpText = '❓ Неизвестная команда. Доступные команды:\n• /clear - очистить хранилище\n• /reload - перезагрузить\n• /dashboard - дашборд\n• /library - библиотека\n• /profile - личный кабинет';
      return { text: helpText, buttons: false, command: null };
    }
    
    // Маппинг команд и их ключевых слов
    const commandMap = {
      clear: { keywords: ['clear', 'очист', 'дроп'], message: '⚠️ Очистить всё хранилище (localStorage и IndexedDB)? Это действие нельзя отменить!' },
      reload: { keywords: ['reload', 'обнов', 'перезагруз'], message: '⚠️ Перезагрузить страницу?' },
      dashboard: { keywords: ['dashboard', 'дашборд', 'дэшборд'], message: '⚠️ Перейти на страницу Дашборда?' },
      library: { keywords: ['library', 'библиотек'], message: '⚠️ Перейти на страницу Библиотеки?' },
      profile: { keywords: ['profile', 'личн', 'профил', 'кабинет'], message: '⚠️ Перейти в Личный кабинет?' }
    };
    
    // Поиск команды по ключевым словам
    for (const [command, { keywords, message }] of Object.entries(commandMap)) {
      if (keywords.some(keyword => cmd.includes(keyword))) {
        pendingCommand = command;
        return { text: message, buttons: true, command };
      }
    }
    
    const helpText = '❓ Неизвестная команда. Доступные команды:\n• /clear - очистить хранилище\n• /reload - перезагрузить\n• /dashboard - дашборд\n• /library - библиотека\n• /profile - личный кабинет';
    return { text: helpText, buttons: false, command: null };
  }

  function cleanAnswer(text) {
    if (!text || typeof text !== 'string') return null;
    
    let cleaned = text;
    for (const pattern of GARBAGE_PATTERNS) {
      cleaned = cleaned.replace(pattern, '');
    }
    
    if (cleaned.trim().length < 10) return null;
    
    const words = cleaned.split(/\s+/);
    const uniqueWords = [...new Set(words)];
    if (words.length > 20 && uniqueWords.length < words.length * 0.3) {
      return null;
    }
    
    cleaned = cleaned
      .replace(/https?:\/\/[^\s\)]+/gi, '')
      .replace(/www\.[^\s\)]+/gi, '')
      .replace(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[\/\?#&][^\s\)]+/gi, '')
      .replace(/@[a-zA-Z0-9]+/g, '')
      .replace(/#[a-zA-Z0-9]+/g, '')
      .replace(/\([^)]*http[^)]*\)/gi, '')
      .replace(/\[[^\]]*http[^\]]*\]/gi, '')
      .replace(/&[a-zA-Z]+;/g, '')
      .replace(/\b[a-z]{8,}[0-9]+[a-z0-9]*\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (cleaned.length < 10 || /^[^а-яА-Яa-zA-Z0-9\s]+$/.test(cleaned)) {
      return null;
    }
    
    if (!/[а-яА-Я]{3,}|[a-zA-Z]{3,}/.test(cleaned)) {
      return null;
    }
    
    return cleaned;
  }

  // Нейросеть получает ТОЛЬКО чистый вопрос пользователя, БЕЗ RAG подсказок
  function buildPrompt(questionText) {
    const trimmedQuestion = questionText ? String(questionText).slice(0, MAX_QUESTION_CHARS) : '';
    // Максимально простой промпт - только вопрос
    return trimmedQuestion;
  }

  function summarizeSnippet(snippet) {
    if (!snippet) return '';
    const normalized = snippet.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
    if (sentences.length === 0) return normalized.substring(0, 200);
    return sentences.slice(0, 2).join(' ').substring(0, 220);
  }

  function cleanGeneratedText(generated, simplePrompt, finalQuestion) {
    if (!generated || generated.trim().length === 0) {
      throw new Error('Модель не сгенерировала текст');
    }
    
    if (simplePrompt && generated.includes(simplePrompt)) {
      const parts = generated.split(simplePrompt);
      generated = parts[parts.length - 1].trim();
    }
    
    const markers = [
      'Answer (in Russian, based on context above):',
      'Answer in Russian based only on context.',
      'Answer based on context:',
      'Answer:', 'Ответ:', 'Context:', 'Question:', 'QUESTION:', 'Вопрос:', 'В:', 'О:',
      'User Context:', 'USER:', 'Portal Context:', 'RAG SUMMARY:', 'IMPORTANT RULES:',
      'You are an AI assistant', 'Ты ассистент', 'Помощник АТУ'
    ];
    
    for (const marker of markers) {
      if (generated.includes(marker)) {
        const parts = generated.split(marker);
        if (parts.length > 1) {
          generated = parts[parts.length - 1].trim();
        }
      }
      if (generated.startsWith(marker)) {
        generated = generated.substring(marker.length).trim();
      }
    }
    
    if (finalQuestion && generated.toLowerCase().startsWith(finalQuestion.toLowerCase())) {
      generated = generated.substring(finalQuestion.length).trim();
    }
    
    if (generated.length > 500) {
      const endMarkers = ['.', '!', '?', '\n'];
      let cutIndex = generated.length;
      for (const marker of endMarkers) {
        const index = generated.indexOf(marker, 200);
        if (index !== -1 && index < cutIndex) {
          cutIndex = index + 1;
        }
      }
      if (cutIndex < generated.length) {
        generated = generated.substring(0, cutIndex).trim();
      } else {
        generated = generated.substring(0, 500).trim() + '...';
      }
    }
    
    const loopPatterns = [
      /(.*?)\s*Ответ:\s*\1\s*Ответ:/gi,
      /(.*?)\s*Answer:\s*\1\s*Answer:/gi,
      /(.*?)\s*\(повторяется\s+\d+\)/gi,
      /\[10\.\s*[^\]]+\]/g,
      /Вопрос:\s*[^\n]+/gi,
      /Output:\s*[^\n]+/gi,
      ...GARBAGE_PATTERNS
    ];
    
    for (const pattern of loopPatterns) {
      generated = generated.replace(pattern, '');
    }
    
    const lines = generated.split(/\n/);
    const cleanLines = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 5) continue;
      
      const hasTooManyCaps = (trimmed.match(/[А-ЯЁA-Z]/g) || []).length > trimmed.length * 0.7;
      const hasStrangeChars = /[А-ЯЁ]{10,}/.test(trimmed) && !/[а-яё]/.test(trimmed);
      const hasOutputPattern = /^(Output|Вопрос|Question|Выведите|Количество|Предложение):/i.test(trimmed);
      const hasArticlePattern = /(стать|статья|предложени|строк|количеств|вывед|экран)/i.test(trimmed) && trimmed.length > 50;
      
      if (hasTooManyCaps || hasStrangeChars || hasOutputPattern || hasArticlePattern) {
        continue;
      }
      
      cleanLines.push(trimmed);
    }
    
    const uniqueLines = [];
    let lastLine = '';
    for (const line of cleanLines) {
      if (line !== lastLine && line.length > 3) {
        const isDuplicate = lastLine && (line.includes(lastLine.substring(0, 20)) || lastLine.includes(line.substring(0, 20)));
        if (!isDuplicate) {
          uniqueLines.push(line);
          lastLine = line;
        }
      }
    }
    
    generated = uniqueLines.join(' ').trim();
    
    const endMarkers = ['.', '!', '?'];
    let firstEnd = -1;
    for (const marker of endMarkers) {
      const index = generated.indexOf(marker, 10);
      if (index !== -1 && (firstEnd === -1 || index < firstEnd)) {
        firstEnd = index;
      }
    }
    if (firstEnd !== -1 && firstEnd < generated.length - 30 && firstEnd > 10) {
      generated = generated.substring(0, firstEnd + 1).trim();
    }
    
    return generated;
  }

  async function handleQuestion(question) {
    // 1. Загружаем ресурсы если нужно
    if (ragEnabled) {
      if (!contextText || typeof contextText !== 'string' || contextText.trim().length < 100) {
        await ensureResources();
      }
      if (!embeddingsPipeline) {
        await ensureResources();
      }
      if (!embeddingsPipeline) {
        throw new Error('Embeddings модель не загружена. Обновите страницу.');
      }
      if (!contextText || typeof contextText !== 'string' || contextText.trim().length < 100) {
        throw new Error('Контекст не загружен. Обновите страницу.');
      }
    }
    
    if (!textGenEngine) {
      await ensureResources();
    }
    if (!textGenEngine) {
      throw new Error('WebLLM не загружен. Обновите страницу.');
    }
    
    // 2. Нормализуем вопрос
    let q = question;
    if (typeof q !== 'string') {
      if (Array.isArray(q)) {
        q = q.join(' ');
      } else if (typeof q === 'object') {
        q = JSON.stringify(q);
      } else {
        q = String(q || '');
      }
    }
    q = q.trim();
    if (!q) {
      throw new Error('Вопрос не может быть пустым');
    }
    
    const finalQuestion = String(q).trim();
    if (!finalQuestion) {
      throw new Error('Вопрос не может быть пустым');
    }
    
    // 3. ОПЕРАТОР 1: Простые приветствия обрабатываем сразу
    if (isSimpleGreeting(finalQuestion)) {
      return handleSimpleGreeting(finalQuestion);
    }
    
    // 4. ОПЕРАТОР 2: RAG - работает отдельно, возвращает готовый ответ БЕЗ нейронки
    const questionIsQuery = looksLikeQuestion(finalQuestion);
    if (ragEnabled && questionIsQuery) {
      setStatus('Ищу релевантную информацию...');
      const ragResult = await findRelevantContext(finalQuestion, contextText);
      
      // Если RAG нашел готовый ответ - возвращаем его НЕМЕДЛЕННО, БЕЗ нейронки
      if (ragResult.readyAnswer) {
        console.log('✅ RAG нашел готовый ответ, возвращаю БЕЗ нейронки');
        setStatus('Готово. Спросите ещё.');
        return ragResult.readyAnswer;
      }
      
      // Если RAG не нашел готовый ответ, но нашел релевантный контекст - тоже возвращаем его
      // (RAG работает как отдельный оператор, не передает данные в нейронку)
      if (ragResult.hasMatches && ragResult.snippet) {
        const hint = summarizeSnippet(ragResult.snippet);
        if (hint && hint.length > 20) {
          console.log('✅ RAG нашел релевантный контекст, возвращаю БЕЗ нейронки');
          setStatus('Готово. Спросите ещё.');
          return hint;
        }
      }
    }
    
    // 5. ОПЕРАТОР 3: Нейросеть - получает ТОЛЬКО чистый вопрос пользователя, БЕЗ RAG
    setStatus('Генерирую ответ (Phi-2)...');
    const simplePrompt = buildPrompt(finalQuestion); // Только вопрос, без RAG!
    
    const timerId = 'neural_' + Date.now();
    console.time(timerId);
    
    try {
      console.log('=== Используем нейронку (Phi-2) ===');
      console.log('Question:', finalQuestion);
      console.log('RAG enabled:', ragEnabled, 'RAG не передается в нейронку');
      console.log('Prompt (только вопрос):', simplePrompt);
      
      if (!textGenEngine) {
        throw new Error('WebLLM не готов. Обновите страницу.');
      }
      
      const result = await runWebLLMCompletion(simplePrompt);
      
      console.log('✅ Model output:', result);
      console.timeEnd(timerId);
      
      if (!result || !result.choices || !Array.isArray(result.choices) || result.choices.length === 0) {
        throw new Error('Модель не вернула ответ. Обновите страницу.');
      }
      
      const choice = result.choices[0];
      const message = choice?.message;
      let generated = '';
      
      if (Array.isArray(message?.content)) {
        generated = message.content.map(part => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && 'text' in part) {
            return part.text || '';
          }
          return '';
        }).join(' ').trim();
      } else if (message?.content) {
        generated = String(message.content).trim();
      } else if (choice?.text) {
        generated = String(choice.text).trim();
      }
      
      console.log('Parsed WebLLM response (raw):', generated);
      
      generated = cleanGeneratedText(generated, simplePrompt, finalQuestion);
      console.log('Parsed WebLLM response (cleaned):', generated);
      
      if (generated && generated.length > 0) {
        generated = cleanAnswer(generated);
        if (generated && generated.length > 0) {
          console.log('✅ Using generated text as answer:', generated.substring(0, 150));
          return generated;
        }
      }
      
      // Fallback для приветствий
      if (isSimpleGreeting(finalQuestion)) {
        console.log('✅ Using greeting fallback');
        return handleSimpleGreeting(finalQuestion);
      }
      
      console.warn('⚠️ Model did not generate valid answer, using fallback');
      return 'Извините, не могу ответить на этот вопрос. Попробуйте переформулировать.';
    } catch (err) {
      console.error('Pipeline error:', err, err.message, err.stack);
      if (err.message && (err.message.includes('split') || err.message.includes('is not a function'))) {
        return 'Ошибка: модель не полностью загружена. Обновите страницу.';
      }
      if (err.message && err.message.includes('fetch')) {
        return 'Ошибка: не удалось загрузить модель. Проверьте интернет-соединение.';
      }
      return 'Ошибка: ' + (err.message || String(err) || 'Неизвестная ошибка при обработке вопроса.');
    } finally {
      setStatus('Готово. Спросите ещё.');
    }
  }

  // Инициализация
  async function loadContext() {
    if (contextText && typeof contextText === 'string' && contextText.trim().length >= 100) {
      return; // Уже загружен
    }
    
    setStatus('Загружаю контекст...');
    console.log('Loading context.txt...');
    
    try {
      const response = await fetch('context.txt');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      
      contextText = await response.text();
      if (typeof contextText !== 'string') {
        contextText = String(contextText || '');
      }
      
      if (contextText.trim().length < 100) {
        throw new Error('Контекст слишком короткий или пустой');
      }
      
      console.log('Context loaded successfully:', {
        length: contextText.length,
        firstChars: contextText.substring(0, 200)
      });
      
      contextChunks = buildContextIndex(contextText);
    } catch (err) {
      console.error('Failed to load context:', err);
      contextText = 'Контекст не удалось загрузить.';
      throw err;
    }
  }

  async function loadEmbeddings() {
    if (embeddingsPipeline) return; // Уже загружена
    
    setStatus('Загружаю модель для поиска...');
    const { pipeline } = window.transformers || {};
    
    if (!pipeline) {
      throw new Error('Transformers не загрузился. Обновите страницу.');
    }
    
    try {
      console.log('Loading embeddings model (Xenova/all-MiniLM-L6-v2)...');
      embeddingsPipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { quantized: true }
      );
      console.log('✅ Embeddings model loaded');
    } catch (err) {
      console.error('Failed to load embeddings model:', err);
      throw new Error('Не удалось загрузить модель для поиска');
    }
  }

  async function ensureResources() {
    console.log('🚀 ensureResources() called');
    
    try {
      await loadContext();
      console.log('✅ Context loaded');
      
      await loadEmbeddings();
      console.log('✅ Embeddings loaded');
      
      if (!textGenEngine) {
        console.log('🔄 Initializing WebLLM engine...');
        const engine = await initWebLLMEngine();
        console.log('✅ WebLLM engine initialized, result:', {
          engine: !!engine,
          textGenEngine: !!textGenEngine,
          hasChat: !!(engine?.chat),
          hasCompletions: !!(engine?.chat?.completions)
        });
        
        // Дополнительная проверка после инициализации
        if (!textGenEngine && engine) {
          console.warn('⚠️ Engine returned but textGenEngine not set, setting manually');
          textGenEngine = engine;
        }
      } else {
        console.log('✅ WebLLM engine already exists');
      }
      
      // Детальная проверка состояния
      console.log('🔍 Checking final state:', {
        embeddingsPipeline: !!embeddingsPipeline,
        textGenEngine: !!textGenEngine,
        embeddingsType: typeof embeddingsPipeline,
        textGenType: typeof textGenEngine,
        textGenHasChat: !!(textGenEngine?.chat),
        textGenHasCompletions: !!(textGenEngine?.chat?.completions)
      });
      
      if (embeddingsPipeline && textGenEngine) {
        console.log('✅✅✅ Both models loaded successfully!');
        setStatus('Готово. Спросите меня о портале.');
        
        if (sendBtn) {
          sendBtn.disabled = false;
          console.log('✅ Send button enabled');
        } else {
          console.warn('⚠️ Send button not found');
        }
        
        const modelBadge = document.getElementById('ai-chat-model-label');
        if (modelBadge) {
          modelBadge.textContent = `WebLLM • ${MODEL_LABEL}`;
        }
        
        if (openBtn) {
          openBtn.classList.remove('ai-chat__open-btn--hidden');
          console.log('✅ Chat open button shown');
        } else {
          console.warn('⚠️ Open button not found');
        }
        
        console.log('⏰ Scheduling notification in 3 seconds...');
        setTimeout(() => {
          console.log('⏰ Time to show notification');
          try {
            showNotification();
            console.log('✅ Notification shown');
          } catch (notifErr) {
            console.error('❌ Error showing notification:', notifErr);
          }
        }, 3000);
      } else {
        console.error('❌❌❌ Models not fully loaded:', {
          embeddings: !!embeddingsPipeline,
          textGen: !!textGenEngine,
          embeddingsError: !embeddingsPipeline ? 'Missing' : 'OK',
          textGenError: !textGenEngine ? 'Missing' : 'OK'
        });
        setStatus('Ошибка загрузки моделей. Проверьте консоль.');
      }
    } catch (err) {
      console.error('❌ ensureResources error:', err);
      console.error('Error stack:', err.stack);
      setStatus('Ошибка инициализации: ' + (err.message || String(err)));
      throw err;
    }
  }

  function playNotificationSound() {
    const audioPaths = [
      'media/new-notification-09-352705.mp3',
      '../media/new-notification-09-352705.mp3',
      '/media/new-notification-09-352705.mp3'
    ];
    
    for (const path of audioPaths) {
      try {
        const audio = new Audio(path);
        audio.volume = 0.5;
        audio.play().catch(() => {
          // Пробуем следующий путь
        });
        return; // Успешно воспроизвели
      } catch (err) {
        // Пробуем следующий путь
      }
    }
  }

  function showNotification() {
    console.log('🔔 showNotification() called');
    
    try {
      const notification = document.createElement('div');
      notification.className = 'ai-notification';
      notification.innerHTML = `
        <div class="ai-notification__icon">🔔</div>
        <div class="ai-notification__text">ИИ-помощник готов!</div>
      `;
      document.body.appendChild(notification);
      console.log('✅ Notification element created and added to DOM');
      
      playNotificationSound();
      
      setTimeout(() => {
        notification.classList.add('ai-notification--visible');
        console.log('✅ Notification made visible');
      }, 100);
      
      notification.addEventListener('click', () => {
        notification.classList.remove('ai-notification--visible');
        setTimeout(() => {
          notification.remove();
          openChat();
        }, 300);
      });
    } catch (err) {
      console.error('❌ Error in showNotification:', err);
    }
  }

  function checkDependencies() {
    const hasTransformers = !!window.transformers;
    const hasWebLLM = !!(window.webllm || window.MLCEngine || window.CreateEngine);
    return { hasTransformers, hasWebLLM };
  }

  function boot() {
    console.log('🔵 boot() called');
    
    const deps = checkDependencies();
    console.log('Checking dependencies:', {
      transformers: deps.hasTransformers,
      webllm: deps.hasWebLLM,
      MLCEngine: !!window.MLCEngine,
      CreateEngine: !!window.CreateEngine
    });
    
    if (!deps.hasTransformers) {
      console.log('⏳ Waiting for transformers...');
      setTimeout(boot, 200);
      return;
    }
    
    if (!deps.hasWebLLM) {
      console.log('⏳ Waiting for WebLLM...');
      setTimeout(boot, 200);
      return;
    }
    
    console.log('✅ All dependencies loaded, starting initialization...');
    ensureResources().catch(err => {
      console.error('❌ ensureResources error:', err);
      setStatus('Ошибка инициализации: ' + (err.message || String(err)));
    });
  }

  function openChat() {
    chat.classList.remove('ai-chat--hidden');
    chat.classList.add('ai-chat--open');
    if (openBtn) {
      openBtn.classList.add('ai-chat__open-btn--hidden');
    }
  }

  function closeChat() {
    chat.classList.remove('ai-chat--open');
    setTimeout(() => {
      chat.classList.add('ai-chat--hidden');
      if (openBtn) {
        openBtn.classList.remove('ai-chat__open-btn--hidden');
      }
    }, 300);
  }

  // Event listeners
  if (toggleBtn) {
    toggleBtn.addEventListener('click', closeChat);
  }

  if (openBtn) {
    openBtn.addEventListener('click', openChat);
  }

  if (ragToggle) {
    ragToggle.addEventListener('change', (e) => {
      ragEnabled = e.target.checked;
      console.log('🔄 RAG', ragEnabled ? 'включен' : 'выключен');
      setStatus(ragEnabled ? 'RAG включен' : 'RAG выключен - простые ответы');
    });
    ragEnabled = ragToggle.checked;
    console.log('🔄 RAG initial state:', ragEnabled ? 'включен' : 'выключен');
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = (input?.value || '').trim();
      if (!question || busy) return;
      busy = true;
      sendBtn.disabled = true;
      appendMessage(question, 'user');
      input.value = '';
      
      try {
        const commandResult = processCommand(question);
        if (commandResult !== null && typeof commandResult === 'object') {
          appendMessage(commandResult.text, 'assistant', commandResult.buttons, commandResult.command);
        } else if (commandResult !== null) {
          appendMessage(commandResult, 'assistant');
        } else if (commandResult === null && !pendingCommand) {
          const reply = await handleQuestion(question);
          if (reply && typeof reply === 'string' && reply.trim()) {
            appendMessage(reply, 'assistant');
          } else {
            appendMessage('Не удалось получить ответ. Попробуйте переформулировать вопрос.', 'assistant');
          }
        }
      } catch (err) {
        console.error('Form submit error:', err);
        appendMessage('Ошибка: ' + err.message, 'assistant');
        setStatus('Не удалось ответить. Попробуйте ещё раз.');
      } finally {
        busy = false;
        sendBtn.disabled = false;
      }
    });
  }

  // Запуск
  setTimeout(() => {
    console.log('🚀 Starting boot sequence...');
    boot();
  }, 500);

  // GPUAdapter fallback
  if (window.GPUAdapter && !GPUAdapter.prototype.requestAdapterInfo) {
    GPUAdapter.prototype.requestAdapterInfo = async function () {
      return {
        vendor: 'unknown',
        architecture: 'unknown',
        device: 'unknown',
        description: 'fallback-adapter-info'
      };
    };
  }
})();

