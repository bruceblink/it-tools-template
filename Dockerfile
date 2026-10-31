# syntax=docker/dockerfile:1.7

# build stage
# The Vite output is platform independent. Keep the Node build on the native
# BuildKit worker so the arm64 image does not run the compiler through QEMU.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build-stage
# Set environment variables for non-interactive installs and the shared pnpm store.
ENV NPM_CONFIG_LOGLEVEL=warn \
    CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack enable && corepack install --global pnpm@12.16.1
RUN --mount=type=cache,id=it-tools-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# production stage
FROM nginx:stable-alpine AS production-stage
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
