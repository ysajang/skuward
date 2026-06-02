FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

# Install ALL deps (incl. devDependencies) — build needs vite, vite-tsconfig-paths, etc.
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

# Remove CLI packages since we don't need them in production by default.
RUN npm remove @shopify/cli

COPY . .

RUN npm run build

# Drop devDependencies after build to slim the runtime image.
RUN npm prune --omit=dev

ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]
