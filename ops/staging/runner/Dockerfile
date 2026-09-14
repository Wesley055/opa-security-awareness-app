FROM node@sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96 AS toolchain
FROM ghcr.io/actions/actions-runner@sha256:e5496277be5d09bc968b3d64911b74e219ac4a3f2edce956a3ecf9271bea1ef4
USER root
COPY --from=toolchain /usr/local/bin/node /opt/opa/node22/bin/node
COPY --from=toolchain /usr/local/lib/node_modules/npm /opt/opa/node22/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /opt/opa/node22/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /opt/opa/node22/bin/npx
COPY verify-toolchain.cjs signal-cleanup.cjs /opt/opa/
ENV PATH="/opt/opa/node22/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
USER 1001:1001
RUN /home/runner/externals/node24/bin/node /opt/opa/verify-toolchain.cjs
