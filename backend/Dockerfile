FROM public.ecr.aws/lambda/nodejs:22

ARG RG_VERSION=15.2.0
ADD https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-aarch64-unknown-linux-musl.tar.gz /tmp/rg.tar.gz
RUN microdnf install -y tar gzip && \
    tar -xzf /tmp/rg.tar.gz -C /tmp && \
    mv /tmp/ripgrep-${RG_VERSION}-aarch64-unknown-linux-musl/rg /usr/local/bin/rg && \
    rm -r /tmp/rg.tar.gz /tmp/ripgrep-${RG_VERSION}-aarch64-unknown-linux-musl && \
    rg --version | grep -F "ripgrep ${RG_VERSION}"
ENV RG_PATH=/usr/local/bin/rg

COPY package.json package-lock.json ${LAMBDA_TASK_ROOT}/
RUN npm ci --omit=dev
COPY corpus ${LAMBDA_TASK_ROOT}/corpus
COPY src ${LAMBDA_TASK_ROOT}/src

CMD ["src/lambda.handler"]
