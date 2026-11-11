FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=27080 TZ=Asia/Shanghai
WORKDIR /app
COPY --chown=node:node . .
USER node
EXPOSE 27080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch("http://127.0.0.1:27080/__health").then(r=>r.json()).then(j=>{if(!j.ok)process.exit(1)}).catch(()=>process.exit(1))'
CMD ["node", "web/server.js", "--port", "27080"]
