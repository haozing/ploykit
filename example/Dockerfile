# syntax=docker/dockerfile:1

# Build with -tags capx so the real render pipeline (platform/capx + chromedp)
# is COMPILED and type-checked into this artifact. This is a build-time decision,
# not a runtime one: the untagged build swaps in render/stub.go and every render
# would be a permanent E_NOT_CONFIGURED even on a host with Chrome installed.
# At runtime the capability is still gated per request (capx.Available() ==
# false when Chrome/ffmpeg are absent, answering 503 E_NOT_CONFIGURED), so this
# image stays safe to ship without the binaries — mount them (or bake a
# chrome+ffmpeg stage into the runtime image) to enable rendering.
FROM golang:1.27.1 AS build
ENV CGO_ENABLED=0 GOPROXY=https://goproxy.cn,direct
WORKDIR /src
COPY . .
WORKDIR /src/example
RUN go build -tags capx -o /out/app ./cmd/app

# Runtime note (deliberate, documented boundary): this stage ships the Go
# binary only — no Chrome, no ffmpeg. To enable video rendering, either mount
# them and point CAPX_CHROME_PATH / CAPX_FFMPEG_PATH at the mounted binaries,
# or extend this stage (apt/apk install chromium + ffmpeg). Leaving them out
# keeps project CRUD / preview / editing fully functional (the capability is
# optional and degrades per request, never at boot).
FROM alpine:3.22
COPY --from=build /out/app /usr/local/bin/app
ENV ADDR=:8030
EXPOSE 8030
ENTRYPOINT ["app"]
