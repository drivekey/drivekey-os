FROM node:24.22.1-bookworm-slim
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY vendor ./vendor
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY dist/merchant.mjs ./dist/merchant.mjs
COPY merchant/schema.sql ./merchant/schema.sql
COPY merchant/public ./merchant/public
COPY ui/vendor ./ui/vendor
COPY ui/assets/Inter.woff2 ./ui/assets/Inter.woff2
COPY THIRD-PARTY-NOTICES.txt ENGINE-LICENSE ./
USER node
EXPOSE 8080
CMD ["node","--no-addons","dist/merchant.mjs"]
