FROM node:25-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && ln -sf /usr/bin/python3 /usr/bin/python \
  && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv

ENV PATH="/opt/venv/bin:${PATH}"

COPY package.json ./
COPY requirements.txt ./

# Strip workspaces field — only the vanilla server is deployed here
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); delete p.workspaces; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));"

RUN npm install \
  && python -m pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=3000
ENV DATA_DIR=./data

EXPOSE 3000

CMD ["node", "src/server.js"]
