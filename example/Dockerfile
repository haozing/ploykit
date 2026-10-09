# syntax=docker/dockerfile:1

FROM golang:1.27.1 AS build
ENV CGO_ENABLED=0 GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY . .
WORKDIR /src/example
RUN go build -o /out/app ./cmd/app

FROM alpine:3.22
COPY --from=build /out/app /usr/local/bin/app
ENV ADDR=:8030
EXPOSE 8030
ENTRYPOINT ["app"]
