# @ploykit/runtime

React SSR / prerender bridge：`hydrate`（客户端注水）、`server`（流式渲染）、`routes`（`routeTable` 契约）与 `browser` 工具。

## 路由栈绑定（编译期，非可选 peer）

`react-router` 是**值引用**（`Routes` / `Route` 在 `routes.ts` 参与运行时渲染），不是类型依赖——`peerDependencies` 里的 `react-router: ^7` 因此是硬性要求，装了本包就必须装 react-router。

**自选路由栈的产品**（如 @tanstack/react-router）**不要安装本包**：直接消费 `@ploykit/client`（请求层）与 `@ploykit/hooks`（状态层）即可，两者对路由栈零依赖。安装警告"missing peer react-router"的正确反应是不装本包，而不是补装一个用不上的路由栈。
