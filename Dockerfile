FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm ls dotenv express cors
COPY . .
EXPOSE 3000
CMD ["npm", "start"]