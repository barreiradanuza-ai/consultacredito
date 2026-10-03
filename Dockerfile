# Imagem oficial da Playwright já traz o Chromium e as dependências do sistema.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

# Porta do serviço (Railway injeta PORT via env)
EXPOSE 3000
CMD ["node", "src/server.js"]
