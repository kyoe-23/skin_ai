#!/bin/bash
# SkinAI Flask AI Service — Production
cd "$(dirname "$0")"
# -w 1: 단일 프로세스 — threading.Semaphore(1)로 동시 추론 1개 제한이 실제로 동작하도록
# --threads 2: 1개 추론 중 다른 요청(health check 등)은 두 번째 스레드가 처리
gunicorn -w 1 --threads 2 -b 0.0.0.0:${FLASK_PORT:-5001} "app:create_app()"
