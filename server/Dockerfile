FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
# Token, generated cookies and yt-dlp state live here (mount a volume).
ENV SANGEET_DATA_DIR=/data
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s CMD python -c "import socket;socket.create_connection(('127.0.0.1',8000),3)"
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
