
// ===== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ =====
const tiltState = new Map();
let smoothScroll = 0;
const scrollSpeed = 0.1;

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
function qAll(selector) { 
  return Array.from(document.querySelectorAll(selector)); 
}

function clamp(v, a, b) { 
  return Math.max(a, Math.min(b, v)); 
}

// ===== ПАРАЛЛАКС =====
function updateParallax() {
  const target = window.scrollY;
  smoothScroll += (target - smoothScroll) * scrollSpeed;

  // Задний слой
  const bg = document.querySelector('.bg-img');
  if (bg) bg.style.transform = `translate3d(0, ${smoothScroll / -6}px, 0)`;

  // Средний 
  const mid = document.querySelector('.mid-img');
  if (mid) mid.style.transform = `translate3d(0, ${smoothScroll / -10}px, 0)`;

  // Градиент 
  const gradient = document.querySelector('.mid-gradient');
  if (gradient) {
    gradient.style.transform = `translate3d(0, ${smoothScroll / -7.1}px, 0)`;
    const fadeDistance = 600;
    const progress = Math.min(smoothScroll / fadeDistance, 1);
    const opacity = progress < 0.1 ? progress / 0.1 : 1;
    gradient.style.opacity = opacity;
  }

  // Передний слой с масштабированием
  const top = document.querySelector('.top-img');
  if (top) {
    const maxScale = 1.1;
    const scaleProgress = Math.min(smoothScroll / 2000, 1);
    const scale = 1 + (maxScale - 1) * scaleProgress;
    top.style.transform = `translateX(-50%) translate3d(0, ${smoothScroll / -5.7}px, 0) scale(${scale})`;
  }
}

// ===== ТЕНИ ЭТАЖЕЙ =====
function updateFloorShadow() {
  const floors = document.querySelectorAll('section.floor');
  const vh = window.innerHeight;
  const center = window.scrollY + vh * 0.5;

  let best = null;
  let bestDist = Infinity;

  // Находим ближайший этаж к центру экрана ,
  floors.forEach(f => {
    const topY = f.offsetTop;
    const bottomY = topY + f.offsetHeight;
    const mid = (topY + bottomY) * 0.5;
    const d = Math.abs(center - mid);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  });

  if (!best) return;
  const card = best.querySelector('.floor-card');
  if (!card) return;

  // Вычисляем динамическую тень
  const rect = best.getBoundingClientRect();
  const mid = rect.top + rect.height / 2;
  const dist = (window.innerHeight / 2) - mid;
  const norm = clamp(dist / (window.innerHeight * 0.5), -1, 1);
  const depth = Math.abs(norm) * 30;
  const offsetY = norm * 8;

  card.style.boxShadow = `0 ${4 + offsetY}px ${12 + depth}px rgba(0,0,0,0.12)`;
}

// ===== УПРАВЛЕНИЕ ПОКРЫТИЯМИ =====
function updateCovers() {
  const vh = window.innerHeight;
  const centerY = window.scrollY + vh * 0.5;
  const floors = document.querySelectorAll('section.floor');

  // Проверяем статус авторизации
  const isLoggedIn = window.DB ? !!DB.getCurrentUser() : false;
  const allCovers = document.querySelectorAll('.cover');
  
  // Если пользователь не авторизован - блокируем все этажи
  if (!isLoggedIn) {
    allCovers.forEach(cover => { 
      cover.style.opacity = "1"; 
      cover.style.pointerEvents = "auto"; 
    });
    return;
  }

  // Находим активный этаж
  let activeFloor = null;
  let closestDist = Infinity;
  floors.forEach(floor => {
    const top = floor.offsetTop;
    const bottom = top + floor.offsetHeight;
    const mid = (top + bottom) / 2;
    const dist = Math.abs(mid - centerY);
    if (dist < closestDist) { 
      closestDist = dist; 
      activeFloor = floor; 
    }
  });

  // Управляем видимостью покрытий
  floors.forEach(floor => {
    const cover = floor.querySelector('.cover');
    if (!cover) return;
    const open = (floor === activeFloor);
    cover.style.opacity = open ? "0" : "1";
    cover.style.pointerEvents = open ? "none" : "auto";
  });
}

// ===== РАЗДЕЛИТЕЛИ ЭТАЖЕЙ =====
let cachedDividers = [];

function refreshDividers() {
  cachedDividers = qAll('.divider');
  cachedDividers.forEach(div => {
    const poly = div.querySelector('.pol-potolok');
    if (poly) poly.dataset.pivotSet = '';
  });
}

// Инициализация и обновление при изменении размера
refreshDividers();
window.addEventListener('resize', refreshDividers);

function updatePolPotolok() {
  const vh = window.innerHeight;
  const magnetY = vh / 2;

  cachedDividers.forEach((div, i) => {
    const line = div.querySelector('.fc-line');
    const poly = div.querySelector('.pol-potolok');
    if (!line || !poly) return;

    // Обработка крайних разделителей
    if (i === 0) {
      poly.style.transform = `translate3d(-50%, 0, 0) rotateX(-70deg)`; // потолок
      return;
    }
    if (i === cachedDividers.length - 1) {
      poly.style.transform = `translate3d(-50%, 0, 0) rotateX(70deg)`; // пол
      return;
    }

    const rect = line.getBoundingClientRect();
    const polyRect = poly.getBoundingClientRect();
    const lineCenter = rect.top + rect.height / 2;

    // Определяем активность разделителя
    const prev = cachedDividers[i - 1]?.querySelector('.fc-line');
    const next = cachedDividers[i + 1]?.querySelector('.fc-line');
    const prevBottom = prev ? prev.getBoundingClientRect().bottom : -Infinity;
    const nextTop = next ? next.getBoundingClientRect().top : Infinity;
    const active = lineCenter > prevBottom && lineCenter < nextTop;

    // Устанавливаем точку поворота один раз
    if (!poly.dataset.pivotSet) {
      const polyH = poly.clientHeight || polyRect.height || 1;
      let pivotYpx = lineCenter - polyRect.top - polyH * 0.08;
      pivotYpx = clamp(pivotYpx, 0, polyH);
      poly.style.transformOrigin = `50% ${pivotYpx}px`;
      poly.dataset.pivotSet = '1';
    }

    // Если неактивен - фиксированный угол
    if (!active) {
      const angle = lineCenter <= prevBottom ? -70 : 70;
      poly.style.transform = `translate3d(-50%,0,0) rotateX(${angle}deg)`;
      tiltState.set(div, angle);
      return;
    }

    // Вычисляем динамический угол
    const dist = lineCenter - magnetY;
    const denom = vh * 0.18;
    let t = clamp(dist / denom, -1.2, 1.2);

    const maxUp = 110;
    const maxDown = 15;
    const targetAngle = t < 0 ? t * maxUp : t * maxDown;

    // Плавная интерполяция
    const prevAngle = tiltState.get(div) || 0;
    const ease = 0.12;
    const angle = prevAngle + (targetAngle - prevAngle) * ease;
    tiltState.set(div, angle);

    // Применяем трансформацию с глубиной
    const depth = angle < 0 ? Math.abs(angle) * 0.4 : Math.abs(angle) * 0.2;
    poly.style.transform = `translate3d(-50%, 0, ${depth}px) rotateX(${angle}deg)`;
  });
}

// ===== ОСНОВНОЙ ЦИКЛ АНИМАЦИИ =====
function frame() {
  updateParallax();
  updatePolPotolok();
  updateFloorShadow();
  updateCovers();
  requestAnimationFrame(frame);
}

// ===== ИНИЦИАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
  refreshDividers();

  // Получаем основные элементы
  const walls = document.querySelector('.walls');
  const elevator = document.querySelector('.elevator');
  const parallax = document.getElementById('parallax');
  const toast = document.querySelector('.toast-auth');
  const profileAction = document.getElementById('profile-action');
  const loginAction = document.getElementById('login-action');
  const exitBtn = document.getElementById('exit-profile');
  const toastForm = document.getElementById('toast-login');
  const toastUser = document.getElementById('toast-user');
  const toastPass = document.getElementById('toast-pass');
  const toastPhoto = document.getElementById('toast-photo');

  // Управление видимостью стен и лифта
  if (walls && parallax) {
    const onScroll = () => {
      const showAt = parallax.offsetTop + parallax.offsetHeight - 40;
      if (window.scrollY > showAt) {
        walls.classList.add('visible');
        if (elevator) elevator.classList.add('visible');
      } else {
        walls.classList.remove('visible');
        if (elevator) elevator.classList.remove('visible');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Запускаем основной цикл анимации
  requestAnimationFrame(frame);

  // ===== СИСТЕМА АВТОРИЗАЦИИ =====
  function getCurrentName(){ 
    return window.DB ? DB.getCurrentUser() : null; 
  }
  
  function isLogged(){ 
    return !!getCurrentName(); 
  }

  function syncAuthUI() {
    const logged = isLogged();
    
    // Управление модальным окном авторизации
    if (toast) {
      if (!logged) toast.classList.add('show'); 
      else toast.classList.remove('show');
    }
    
    // Управление кнопками профиля
    if (profileAction) profileAction.style.display = logged ? '' : 'none';
    if (loginAction) loginAction.style.display = logged ? 'none' : '';

    // Управление покрытиями этажей
    const covers = document.querySelectorAll('.cover');
    covers.forEach(c => {
      c.style.opacity = logged ? '0' : '1';
      c.style.pointerEvents = logged ? 'none' : 'auto';
    });

    // Заполнение данных пользователя на 1-м этаже
    const userObj = window.DB && logged ? DB.getCurrentUserObj() : null;
    const nameEls = document.querySelectorAll('#user-name');
    const groupEls = document.querySelectorAll('#group-name');
    const programEls = document.querySelectorAll('#program-name');
    const imgEls = document.querySelectorAll('#img-user');
    
    if (userObj) {
      nameEls.forEach(el => { if (el) el.textContent = userObj.name || ''; });
      groupEls.forEach(el => { if (el) el.textContent = userObj.group || ''; });
      programEls.forEach(el => { if (el) el.textContent = userObj.program || ''; });
      imgEls.forEach(el => { if (el && userObj.photo) el.style.backgroundImage = `url(${userObj.photo})`; });
    }
  }
  syncAuthUI();

  if (exitBtn) exitBtn.addEventListener('click', () => {
    if (window.DB) DB.logout();
    syncAuthUI();
  });

  if (toastForm) toastForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!window.DB) return;
    const name = (toastUser.value || '').trim();
    const pass = (toastPass.value || '').trim();

    // Если пользователь существует — авторизация; если нет — регистрируем
    let user = DB.getUser(name);
    if (!user) {
      let photoData = null;
      if (toastPhoto.files && toastPhoto.files[0]) {
        photoData = await DB.compressImageToDataURL(toastPhoto.files[0], 256, 0.75);
      }
      user = { name, pass, photo: photoData, group: DB.randomGroup(), program: 'АТУ — бакалавриат' };
      DB.upsertUser(user);
      DB.setCurrentUser(name);
    } else {
      const ok = DB.auth(name, pass);
      if (!ok) { alert('Неверные данные'); return; }
      // обновим фото, если выбрано
      if (toastPhoto.files && toastPhoto.files[0]) {
        user.photo = await DB.compressImageToDataURL(toastPhoto.files[0], 256, 0.75);
        DB.upsertUser(user);
      }
    }
    syncAuthUI();
  });
});

// === ELEVATOR ===
(function setupElevator() {
  const floors = Array.from(document.querySelectorAll('section.floor'));
  const elev = document.querySelector('.elevator');
  if (!floors.length || !elev) return;

  const btnUp = elev.querySelector('.elev-up');
  const btnDown = elev.querySelector('.elev-down');
  const label = elev.querySelector('#elev-floor');
  const labelNameEl = elev.querySelector('.elev-floor-label');
  const jumps = Array.from(elev.querySelectorAll('.elev-jump'));

  const floorNames = floors.map((f, i) => {
    const h3 = f.querySelector('h3');
    const name = h3 ? (h3.textContent || '').trim() : `Этаж ${6 - i}`;
    if (jumps[i]) {
      jumps[i].setAttribute('data-name', name);
      jumps[i].setAttribute('title', name);
    }
    return name;
  });

  let lastIdx = 0;
  function currentFloorIndex() {
    const vh = window.innerHeight;
    const center = window.scrollY + vh * 0.5;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < floors.length; i++) {
      const top = floors[i].offsetTop;
      const bottom = top + floors[i].offsetHeight;
      const mid = (top + bottom) * 0.5;
      const d = Math.abs(center - mid);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    lastIdx = bestIdx;
    return lastIdx;
  }

  function gotoFloor(i) {
    i = Math.max(0, Math.min(floors.length - 1, i));
    const y = floors[i].offsetTop + 1;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  function syncUI() {
    const idx = currentFloorIndex();
    const human = 6 - idx;
    if (label) label.textContent = String(human);
    if (labelNameEl) labelNameEl.textContent = floorNames[idx] || 'Этаж';
    jumps.forEach((b, j) => b.classList.toggle('active', j === idx));
  }

  if (btnUp) btnUp.addEventListener('click', () => gotoFloor(currentFloorIndex() - 1));
  if (btnDown) btnDown.addEventListener('click', () => gotoFloor(currentFloorIndex() + 1));
  jumps.forEach(b => b.addEventListener('click', () => gotoFloor(parseInt(b.dataset.floor, 10))));

  window.addEventListener('scroll', syncUI, { passive: true });
  window.addEventListener('resize', syncUI);
  syncUI();
})();
// === Динамический фон для карточки новостей ===
window.addEventListener('load', () => {
  const newsCard = document.querySelector('.news-content');
  if (!newsCard) return;

  const images = [
    'media/news/s650.webp',
    'media/news/s652.webp',
    'media/news/s653.webp',
    'media/news/s654.webp'
  ];

  let index = 0;
  const interval = 7000; // каждые 7 секунд

  const fadeLayer = document.createElement('div');
  fadeLayer.className = 'news-fade-layer';
  newsCard.appendChild(fadeLayer);

  function changeBackground() {
    const next = images[index];
    fadeLayer.style.backgroundImage = `url('${next}')`;
    fadeLayer.classList.add('fade-active');

    setTimeout(() => {
      newsCard.style.backgroundImage = `url('${next}')`;
      fadeLayer.classList.remove('fade-active');
      index = (index + 1) % images.length;
    }, 1000);
  }

  newsCard.style.backgroundImage = `url('${images[0]}')`;
  changeBackground();
  setInterval(changeBackground, interval);
});


// === Мягкий вертикальный скролл карточек новостей через Swiper ===
window.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.news-grid');
  if (!grid || typeof Swiper === 'undefined') return;

  const swiper = new Swiper(grid.parentElement, {
    wrapperClass: 'news-grid',
    slideClass: 'news-card',
    direction: 'vertical',
    slidesPerView: 'auto',
    freeMode: {
      enabled: true,
      momentum: true,
      momentumRatio: 0.25,
    },
    mousewheel: {
      enabled: false, // включаем вручную при наведении
      releaseOnEdges: true,
      forceToAxis: true,
      sensitivity: 0.4,
    },
    slidesOffsetBefore: 100,
    slidesOffsetAfter: 100,
    centeredSlidesBounds: true,
    setWrapperSize: false,
    loop: false,
    speed: 500,
  });

  // логическая блокировка прокрутки страницы (без overflow:hidden)
  let disableScroll = false;
  function onPageScroll(e) {
    if (disableScroll) e.preventDefault();
  }
  window.addEventListener('wheel', onPageScroll, { passive: false });

  // включаем прокрутку только при наведении именно на блок карточек
  grid.addEventListener('mouseenter', () => {
    swiper.mousewheel.enable();
    disableScroll = true;
  });

  grid.addEventListener('mouseleave', () => {
    swiper.mousewheel.disable();
    disableScroll = false;
  });

  window.addEventListener('resize', () => swiper.update());
});
