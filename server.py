#!/usr/bin/env python3
"""
Простой HTTP сервер для запуска WebLLM с правильными заголовками
Использование: python server.py
"""

import http.server
import socketserver
import os
from pathlib import Path

PORT = 3000

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Устанавливаем критически важные заголовки для WebLLM
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        super().end_headers()

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")

if __name__ == "__main__":
    os.chdir(Path(__file__).parent)
    
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        print(f"\n🚀 Сервер запущен на http://localhost:{PORT}")
        print(f"📝 Откройте браузер и перейдите по адресу: http://localhost:{PORT}")
        print(f"\n⚠️  ВАЖНО: WebLLM требует эти заголовки для работы:")
        print(f"   - Cross-Origin-Opener-Policy: same-origin")
        print(f"   - Cross-Origin-Embedder-Policy: require-corp")
        print(f"\n🛑 Для остановки нажмите Ctrl+C\n")
        httpd.serve_forever()

