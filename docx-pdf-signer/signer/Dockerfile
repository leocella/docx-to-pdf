FROM python:3.12-slim

# Dependências de sistema para pyHanko (image-support/opentype usam libs nativas)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev libjpeg-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# usuário não-root
RUN useradd -m -u 1001 signer && mkdir -p /tmp/signer && chown signer:signer /tmp/signer
USER signer

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
