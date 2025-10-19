# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [2.9.0-12](https://github.com/koatty/koatty_serve/compare/v2.9.0-11...v2.9.0-12) (2025-10-19)

## [2.9.0-11](https://github.com/koatty/koatty_serve/compare/v2.9.0-10...v2.9.0-11) (2025-10-19)

## [2.9.0-10](https://github.com/koatty/koatty_serve/compare/v2.9.0-9...v2.9.0-10) (2025-10-16)

## [2.9.0-10] (2025-10-16)

### Features

* **grpc**: enhance gRPC callback handling with timeout detection, duplicate call protection, and comprehensive logging ([#xxx](https://github.com/koatty/koatty_serve/issues/xxx))
  - Add 30-second timeout mechanism to detect callbacks not being called
  - Prevent callback from being called multiple times
  - Add detailed request lifecycle logging (start, success, error, timeout)
  - Standardize gRPC error format with proper status codes
  - Add response data validation and structure logging
  - Improve error handling with proper exception catching
  - Add comprehensive documentation in Chinese and English

### Documentation

* add `docs/GRPC_RESPONSE_FIX_CN.md` - Comprehensive Chinese guide for gRPC response handling
* add `docs/GRPC_RESPONSE_FIX_EN.md` - English summary of gRPC enhancements

### Bug Fixes

* **grpc**: fix EOF errors caused by callbacks not being called
* **grpc**: fix "status: 0" and "action: undefined" issues in responses

## [2.9.0-9](https://github.com/koatty/koatty_serve/compare/v2.9.0-8...v2.9.0-9) (2025-10-15)

## [2.9.0-8](https://github.com/koatty/koatty_serve/compare/v2.9.0-7...v2.9.0-8) (2025-10-15)

## [2.9.0-7](https://github.com/koatty/koatty_serve/compare/v2.9.0-6...v2.9.0-7) (2025-10-15)

## [2.9.0-6](https://github.com/koatty/koatty_serve/compare/v2.9.0-5...v2.9.0-6) (2025-10-12)

## [2.9.0-5](https://github.com/koatty/koatty_serve/compare/v2.9.0-4...v2.9.0-5) (2025-10-12)

## [2.9.0-4](https://github.com/koatty/koatty_serve/compare/v2.9.0-3...v2.9.0-4) (2025-10-12)

## [2.9.0-3](https://github.com/koatty/koatty_serve/compare/v2.9.0-2...v2.9.0-3) (2025-10-12)

## [2.9.0-2](https://github.com/koatty/koatty_serve/compare/v2.9.0-1...v2.9.0-2) (2025-10-12)


### Features

* add Koatty-style server startup logs with protocol and URL info for all server types ([aa1c106](https://github.com/koatty/koatty_serve/commit/aa1c1065383c8589ba56d511c1eba517268c50e0))

## [2.9.0-1](https://github.com/koatty/koatty_serve/compare/v2.8.0...v2.9.0-1) (2025-10-12)


### Features

* add HTTP/3 protocol support with MatrixAI QUIC and Node.js native implementations, including config, adapters and connection pool ([d07f72a](https://github.com/koatty/koatty_serve/commit/d07f72a5285073bf779aed1c3cc47bb6c091885f))
* add HTTP/3 server integration tests with QPACK and frame handling, including certificate fixtures and end-to-end request/response simulation ([fd88238](https://github.com/koatty/koatty_serve/commit/fd88238f922be81ae9cbe8ea434b617ca3439b85))
* add HTTP/3 server support with QUIC protocol implementation, including config, adapters, connection pool and comprehensive testing ([e72b2a5](https://github.com/koatty/koatty_serve/commit/e72b2a53dc997d2d55fde235c300f51452dc5ead))
* enhance connection pool and server monitoring with RingBuffer for latency metrics, improved event listener error handling, and server health tracking ([dd3d24d](https://github.com/koatty/koatty_serve/commit/dd3d24d8bf8e5afb48a5ba6fd2e81c2e0a38e49c))
* refactor server implementation from MultiProtocolServer to SingleProtocolServer with simplified protocol handling and removed multi-protocol support ([f10c6a6](https://github.com/koatty/koatty_serve/commit/f10c6a61ed5680317620e69a1078b13564e8fcec))
* update README to reflect single protocol design and add NewServe examples, bump version to 2.5.0 ([da5beb7](https://github.com/koatty/koatty_serve/commit/da5beb7fda873c0d34dcdda2f7b9e0ce434b3f4f))

## [2.6.0-0](https://github.com/koatty/koatty_serve/compare/v2.5.0...v2.6.0-0) (2025-10-12)


### Features

* enhance connection pool and server monitoring with RingBuffer for latency metrics, improved event listener error handling, and server health tracking ([e4c4860](https://github.com/koatty/koatty_serve/commit/e4c4860cd09a0d7de06c367c4154b7cf74e1329b))
* refactor MultiProtocolServer for unified protocol management with enhanced status tracking, primary server instance handling, and improved service registration safety ([5d4c376](https://github.com/koatty/koatty_serve/commit/5d4c376bbd68c2b7beb2367d07e4f4b75f414b11))
* refactor server implementation from MultiProtocolServer to SingleProtocolServer with simplified protocol handling and removed multi-protocol support ([a4d1c0f](https://github.com/koatty/koatty_serve/commit/a4d1c0fea848b669b48586642c0b1e50c6ef54c5))
* update README to reflect single protocol design and add NewServe examples, bump version to 2.5.0 ([347efee](https://github.com/koatty/koatty_serve/commit/347efee81f3c16550e734f26e1588db08809ac0b))

## [2.5.0](https://github.com/koatty/koatty_serve/compare/v2.4.0...v2.5.0) (2025-06-06)


### Features

* add comprehensive health monitoring, HTTP/2 enhancements, and SSL/TLS improvements with hot reload and graceful shutdown support ([786f782](https://github.com/koatty/koatty_serve/commit/786f782b9fa5476a5667fa8f9a8cae78f409dc17))
* complete unified connection pool system integration across all protocols (HTTP/HTTPS/HTTP2/gRPC/WebSocket) with standardized management, health checks, metrics, and event-driven architecture ([8efec82](https://github.com/koatty/koatty_serve/commit/8efec826f3c0a49e472e31a41df35e4e69605263))
* enhance HTTPS connection pool security with improved error logging and metadata iteration optimization ([54f8c79](https://github.com/koatty/koatty_serve/commit/54f8c799c0fe41091f522b2dc0b714b9f537e521))
* enhance server infrastructure with structured logging, connection monitoring, and improved configuration management ([92677a1](https://github.com/koatty/koatty_serve/commit/92677a19cc7a6137222966e6ff62d93f318cf3de))
* implement connection pooling for gRPC and HTTP servers with enhanced health checks, metrics collection, and runtime configuration support ([7c149f4](https://github.com/koatty/koatty_serve/commit/7c149f4e5f8ac79f653dbbcbc7c640c16029f67a))
* implement multi-protocol server support with automatic port allocation and unified management ([8356746](https://github.com/koatty/koatty_serve/commit/83567461031fd29f44f4feebb764adf89ad01f64))
* major enterprise-grade refactor with unified multi-protocol architecture, hot-config reload, five-step graceful shutdown, comprehensive health checks, Prometheus metrics, structured logging, and enhanced security features including TLS/SSL and connection pooling ([55daa8e](https://github.com/koatty/koatty_serve/commit/55daa8ef2f207062d43ff776a8ca4f02bbab1132))
* refactor GrpcServer class with enhanced configuration management, protocol-specific connection pool integration, and improved type safety for gRPC options ([e40a849](https://github.com/koatty/koatty_serve/commit/e40a849f647030f1cf10b12647ed657838b2e716))
* refactor SSL/TLS configuration structure with base and advanced interfaces, improve gRPC connection pool management with protocol-specific settings, and enhance GrpcServer class typing and initialization logic ([415156a](https://github.com/koatty/koatty_serve/commit/415156a1cf2817d7e0d02b5bdd97c83405709d48))
* update HTTP/2 and gRPC server documentation with new connection pool management, protocol-specific initialization, and enhanced configuration options ([4a547b5](https://github.com/koatty/koatty_serve/commit/4a547b5aa1168b104d153eddb125f6b8375891e5))
* update server termination logic to include application context in signal handlers for all server ([c82d4bc](https://github.com/koatty/koatty_serve/commit/c82d4bcbc1d2d2884ef63ade4ef3783c7be4f8dd))

## 2.5.0 (2025-04-15) - 企业级架构重构版本

### 🚀 重大架构更新

* **feat**: 实现统一协议架构 - 基于 BaseServer 抽象类的多协议统一管理
* **feat**: 实现配置热重载功能 - 智能检测配置变更，支持运行时配置更新和自动优雅重启
* **feat**: 实现五步式优雅关闭 - 确保数据完整性和连接安全的优雅停机流程
* **feat**: 实现健康检查系统 - 多层次健康状态监控，支持协议特定检查
* **feat**: 实现性能指标收集 - 实时指标收集、历史数据管理、Prometheus集成
* **feat**: 实现结构化日志系统 - 带追踪ID的统一日志记录和监控

### 🔐 安全功能增强

* **feat**: gRPC服务器 SSL/TLS 安全增强 - 支持三种安全模式（insecure/one_way_tls/mutual_tls）
* **feat**: 连接池管理和性能优化 - HTTP/2多路复用、keep-alive机制、连接统计
* **feat**: SSL证书管理 - 自动文件系统加载、错误恢复、配置热重载检测
* **feat**: 安全连接重用 - gRPC通道复用、连接池清理、实时统计监控

### 🏥 企业级监控功能

* **feat**: HTTP健康检查端点 - `/health`, `/metrics`, `/servers` RESTful API
* **feat**: 多格式指标导出 - JSON格式、Prometheus格式、历史数据查询
* **feat**: 实时性能监控 - 连接统计、请求统计、系统资源监控
* **feat**: 可配置健康检查 - 自定义检查间隔、超时、检查项目
* **feat**: 全协议健康检查 - HTTP/HTTPS/HTTP2/WebSocket/gRPC 特定检查

### 🔄 配置管理升级

* **feat**: 智能配置变更检测 - 区分关键配置（需重启）和运行时配置（实时应用）
* **feat**: 配置热重载 - SSL证书、连接池配置、监控配置的动态更新
* **feat**: 配置版本管理 - 配置变更历史、回滚支持、变更审计日志
* **feat**: 扩展配置支持 - 健康检查配置、指标收集配置、连接管理配置

### 🛡️ 优雅关闭增强

* **feat**: 五步式关闭流程:
  1. 停止接受新连接
  2. 等待排空延迟（让负载均衡器发现状态变化）
  3. 等待现有连接完成
  4. 强制关闭剩余连接
  5. 清理监控和资源
* **feat**: 可配置关闭超时 - 总超时、步骤超时、排空延迟配置
* **feat**: 连接状态监控 - 实时连接数监控、关闭进度跟踪
* **feat**: 错误恢复机制 - 优雅关闭失败时的强制关闭备用方案

### 📊 协议特定增强

#### HTTP/HTTPS 服务器
* **feat**: 连接跟踪和统计 - 活跃连接监控、连接生命周期管理
* **feat**: SSL配置热重载 - 证书更新检测、自动重启
* **feat**: 请求指标收集 - 响应时间、成功率、错误率统计

#### WebSocket 服务器  
* **feat**: 高级连接管理 - 连接限制、超时管理、自动清理
* **feat**: 连接池优化 - 最大连接数限制、连接超时配置
* **feat**: WSS 安全连接 - SSL配置变更检测、证书管理

#### gRPC 服务器
* **feat**: 连接池管理器 - GrpcConnectionManager类，连接复用和统计
* **feat**: 服务方法监控 - 方法调用包装、性能统计、错误监控
* **feat**: 三种安全模式 - insecure开发模式、one_way_tls生产模式、mutual_tls高安全模式

#### HTTP/2 服务器
* **feat**: ALPN协商支持 - HTTP/1.1回退、协议自动选择
* **feat**: 多路复用优化 - 并发流管理、性能监控
* **feat**: SSL配置继承 - 复用HTTPS服务器的SSL逻辑

### 🧪 测试和质量保证

* **test**: 综合测试套件 - 14个健康检查和指标收集测试用例
* **test**: 配置热重载测试 - 关键配置和运行时配置变更测试
* **test**: 优雅关闭测试 - 五步关闭流程、超时处理、错误恢复测试
* **test**: SSL/TLS安全测试 - 证书加载、安全模式切换、错误处理测试
* **test**: 性能监控测试 - 指标收集、历史数据、端点响应测试

### 📚 文档和示例

* **docs**: 统一协议架构文档 - BaseServer设计、协议实现指南
* **docs**: 健康监控实现文档 - 功能说明、配置示例、集成指南
* **docs**: 完整的使用示例 - 健康监控示例、多协议配置示例
* **docs**: 生产环境部署指南 - Kubernetes、Docker、Nginx集成

### 🔧 工具和实用功能

* **feat**: 全局健康处理器 - globalHealthHandler，统一服务器注册和管理
* **feat**: 结构化日志工具 - 带追踪ID的日志记录、上下文管理
* **feat**: 助手工具函数 - 深度对象比较、配置合并、错误处理
* **feat**: 健康端点中间件 - 开箱即用的HTTP健康检查服务

### ⚡ 性能优化

* **perf**: 连接池优化 - 减少连接创建开销，提高并发性能
* **perf**: 监控开销优化 - 低CPU和内存占用的监控实现
* **perf**: 日志性能优化 - 异步日志记录、批量处理
* **perf**: 指标收集优化 - 高效的数据结构、内存管理

### 🛠️ 开发体验改进

* **feat**: TypeScript类型完善 - 完整的接口定义、类型安全
* **feat**: ESLint配置优化 - 代码质量检查、格式统一
* **feat**: Jest测试配置 - 测试覆盖率报告、HTML报告生成
* **feat**: 开发调试支持 - 详细错误信息、调试日志、追踪功能

### 🔄 向后兼容性

* **compat**: 完全向后兼容 - 现有API保持不变，新功能可选启用
* **compat**: 配置扩展兼容 - 新配置项为可选，不影响现有配置
* **compat**: 服务器接口兼容 - KoattyServer接口扩展，保持现有方法

### 🏭 生产环境就绪

* **feat**: Kubernetes集成 - 健康检查探针、配置管理、服务发现
* **feat**: Prometheus集成 - 指标格式兼容、标签支持、时间序列数据
* **feat**: 负载均衡器支持 - Nginx健康检查、HAProxy集成
* **feat**: 容器化支持 - Docker健康检查、信号处理、优雅关闭

---

## 2.4.0 (2025-04-12)

* build: dep ([2cdb06f](https://github.com/koatty/koatty_serve/commit/2cdb06f))
* build: deps ([40bbf08](https://github.com/koatty/koatty_serve/commit/40bbf08))
* build: deps ([fcccf95](https://github.com/koatty/koatty_serve/commit/fcccf95))
* build: update dependencies ([9acca8b](https://github.com/koatty/koatty_serve/commit/9acca8b))
* build: update dependencies to latest versions ([d9e4e6a](https://github.com/koatty/koatty_serve/commit/d9e4e6a))
* build: update koatty_core to version 1.15.0 and adjust peerDependencies ([05226cf](https://github.com/koatty/koatty_serve/commit/05226cf))
* build: v2.4.0 ([a6f906c](https://github.com/koatty/koatty_serve/commit/a6f906c))
* chore: add supertest for HTTP request testing and update dependencies ([059f149](https://github.com/koatty/koatty_serve/commit/059f149))
* test: add comprehensive tests for server instances and terminus utility ([52704f9](https://github.com/koatty/koatty_serve/commit/52704f9))
* refactor: enhance server configuration for secure protocols ([5c16a00](https://github.com/koatty/koatty_serve/commit/5c16a00))
* refactor: implement base server class with config hot reload and update protocol support ([4ee5af5](https://github.com/koatty/koatty_serve/commit/4ee5af5))
* refactor: improve server stop logic and error handling across various server implementations ([21ca8cb](https://github.com/koatty/koatty_serve/commit/21ca8cb))
* refactor: move terminus utility to utils directory for better code organization ([c243a67](https://github.com/koatty/koatty_serve/commit/c243a67))
* refactor: remove unused trace option from ListeningOptions interface ([4a18f09](https://github.com/koatty/koatty_serve/commit/4a18f09))
* refactor: standardize key and certificate file property names in server configuration ([d124593](https://github.com/koatty/koatty_serve/commit/d124593))
* fix: update LastEditTime and cast server instance to KoattyServer ([bbede71](https://github.com/koatty/koatty_serve/commit/bbede71))
* docs: api doc ([063c3ec](https://github.com/koatty/koatty_serve/commit/063c3ec))



## 2.3.0 (2024-12-03)

* build: deps ([9666bca](https://github.com/koatty/koatty_serve/commit/9666bca))
* build: deps ([5f472ba](https://github.com/koatty/koatty_serve/commit/5f472ba))
* build: v2.3.0 ([d222fcb](https://github.com/koatty/koatty_serve/commit/d222fcb))
* fix: default config ([a5ee9bd](https://github.com/koatty/koatty_serve/commit/a5ee9bd))
* fix: grpc server.start is deprecated ([8639cca](https://github.com/koatty/koatty_serve/commit/8639cca))
* fix: native server types ([6298470](https://github.com/koatty/koatty_serve/commit/6298470))
* feat:  add support for custom HTTP server in WebSocket server options ([fbe0a9a](https://github.com/koatty/koatty_serve/commit/fbe0a9a))
* chore: tsconfig ([34f61c3](https://github.com/koatty/koatty_serve/commit/34f61c3))



## 2.2.0 (2024-11-07)

* build: deps ([25e6fc1](https://github.com/koatty/koatty_serve/commit/25e6fc1))
* build: v2.2.0 ([6472dc1](https://github.com/koatty/koatty_serve/commit/6472dc1))
* refactor: rollup ([fb6eaf1](https://github.com/koatty/koatty_serve/commit/fb6eaf1))



## <small>2.1.6-0 (2024-10-31)</small>

* build: deps ([58743ee](https://github.com/koatty/koatty_serve/commit/58743ee))
* build: v2.1.6-0 ([7848993](https://github.com/koatty/koatty_serve/commit/7848993))
* perf: 性能优化 ([885a4a7](https://github.com/koatty/koatty_serve/commit/885a4a7))



## <small>2.1.5 (2024-06-25)</small>

* build: deps ([9379bec](https://github.com/koatty/koatty_serve/commit/9379bec))
* build: deps ([2dc032f](https://github.com/koatty/koatty_serve/commit/2dc032f))
* build: deps ([618199a](https://github.com/koatty/koatty_serve/commit/618199a))
* build: deps ([830b364](https://github.com/koatty/koatty_serve/commit/830b364))
* build: deps ([a4f014f](https://github.com/koatty/koatty_serve/commit/a4f014f))
* build: v2.1.1 ([2171c4c](https://github.com/koatty/koatty_serve/commit/2171c4c))
* build: v2.1.2 ([3b51bb7](https://github.com/koatty/koatty_serve/commit/3b51bb7))
* build: v2.1.2-0 ([632a901](https://github.com/koatty/koatty_serve/commit/632a901))
* build: v2.1.2-1 ([179c93f](https://github.com/koatty/koatty_serve/commit/179c93f))
* build: v2.1.2-2 ([529d213](https://github.com/koatty/koatty_serve/commit/529d213))
* build: v2.1.4 ([90045c3](https://github.com/koatty/koatty_serve/commit/90045c3))
* build: v2.1.5 ([32168a0](https://github.com/koatty/koatty_serve/commit/32168a0))
* refactor: requestParam重新定义 ([4709fa9](https://github.com/koatty/koatty_serve/commit/4709fa9))
* refactor: router 分离 ([436bc25](https://github.com/koatty/koatty_serve/commit/436bc25))
* refactor: router接口变更 ([ed60213](https://github.com/koatty/koatty_serve/commit/ed60213))
* fix: dto参数预处理 ([c3ed24f](https://github.com/koatty/koatty_serve/commit/c3ed24f))
* fix: export parser ([e001b9a](https://github.com/koatty/koatty_serve/commit/e001b9a))
* fix: path subfix ([ba4f74d](https://github.com/koatty/koatty_serve/commit/ba4f74d))
* fix: remove export ([52dd457](https://github.com/koatty/koatty_serve/commit/52dd457))
* fix: 处理path ([464c2d7](https://github.com/koatty/koatty_serve/commit/464c2d7))
* fix: 移除app循环引用 ([c305504](https://github.com/koatty/koatty_serve/commit/c305504))



## 2.1.0 (2023-12-14)

* build: deps ([977096b](https://github.com/koatty/koatty_serve/commit/977096b))
* build: v2.1.0 ([c08e354](https://github.com/koatty/koatty_serve/commit/c08e354))
* chore: pnpm ([8fbcacb](https://github.com/koatty/koatty_serve/commit/8fbcacb))
* fix: type defined ([b4749ee](https://github.com/koatty/koatty_serve/commit/b4749ee))
* docs: api doc ([3dec10a](https://github.com/koatty/koatty_serve/commit/3dec10a))



## 2.1.0-0 (2023-12-09)

* build: deps ([dc4049f](https://github.com/koatty/koatty_serve/commit/dc4049f))
* build: v2.1.0-0 ([7cbb2fd](https://github.com/koatty/koatty_serve/commit/7cbb2fd))
* fix: comment ([3882d95](https://github.com/koatty/koatty_serve/commit/3882d95))
* fix: merge payload ([5eef05e](https://github.com/koatty/koatty_serve/commit/5eef05e))
* fix: parseBody ([97d8f61](https://github.com/koatty/koatty_serve/commit/97d8f61))
* fix: 调整结构 ([e82f6eb](https://github.com/koatty/koatty_serve/commit/e82f6eb))



## <small>2.0.4 (2023-07-26)</small>

* build: v2.0.4 ([ff3018e](https://github.com/koatty/koatty_serve/commit/ff3018e))



## <small>2.0.3 (2023-07-26)</small>

* build: v2.0.3 ([f844744](https://github.com/koatty/koatty_serve/commit/f844744))
* fix: hostname ([ff692ab](https://github.com/koatty/koatty_serve/commit/ff692ab))
* docs: apis ([6bfc0d0](https://github.com/koatty/koatty_serve/commit/6bfc0d0))



## <small>2.0.2 (2023-07-26)</small>

* build: v2.0.2 ([71959fc](https://github.com/koatty/koatty_serve/commit/71959fc))
* fix: default options ([e2634a8](https://github.com/koatty/koatty_serve/commit/e2634a8))
* docs: apis ([033000f](https://github.com/koatty/koatty_serve/commit/033000f))



## <small>2.0.1 (2023-07-26)</small>

* build: v2.0.1 ([8bdd62e](https://github.com/koatty/koatty_serve/commit/8bdd62e))
* fix: options ([1a34369](https://github.com/koatty/koatty_serve/commit/1a34369))
* refactor: merge router ([6e5ca36](https://github.com/koatty/koatty_serve/commit/6e5ca36))



## 2.0.0 (2023-07-26)

* build: v1.6.0 ([a1f334f](https://github.com/koatty/koatty_serve/commit/a1f334f))
* build: v2.0.0 ([bb25062](https://github.com/koatty/koatty_serve/commit/bb25062))



## <small>1.5.6 (2023-02-26)</small>

* build: deps ([67e82bc](https://github.com/koatty/koatty_serve/commit/67e82bc))
* build: deps ([dde21f4](https://github.com/koatty/koatty_serve/commit/dde21f4))
* build: v1.5.6 ([7085d1f](https://github.com/koatty/koatty_serve/commit/7085d1f))



## <small>1.5.5 (2023-02-10)</small>

* build: deps ([49eea51](https://github.com/koatty/koatty_serve/commit/49eea51))
* build: v1.5.5 ([9d391e9](https://github.com/koatty/koatty_serve/commit/9d391e9))



## <small>1.5.4 (2023-01-13)</small>

* build: deps ([77d07d2](https://github.com/koatty/koatty_serve/commit/77d07d2))
* build: v1.5.4 ([2a089cb](https://github.com/koatty/koatty_serve/commit/2a089cb))
* fix: typeof server ([af1ef45](https://github.com/koatty/koatty_serve/commit/af1ef45))



## <small>1.5.2 (2023-01-13)</small>

* build: v1.5.2 ([fa0b532](https://github.com/koatty/koatty_serve/commit/fa0b532))



## <small>1.5.1 (2022-11-16)</small>

* build: v1.5.1 ([fca911a](https://github.com/koatty/koatty_serve/commit/fca911a))
* fix: remove SIGKILL ([19ba943](https://github.com/koatty/koatty_serve/commit/19ba943))



## 1.5.0 (2022-11-16)

* build: v1.5.0 ([29b9287](https://github.com/koatty/koatty_serve/commit/29b9287))
* fix: timeout ([d50110b](https://github.com/koatty/koatty_serve/commit/d50110b))
* fix: trminus ([d4af2f2](https://github.com/koatty/koatty_serve/commit/d4af2f2))



## <small>1.4.12 (2022-10-31)</small>

* build: v1.4.12 ([f94a92a](https://github.com/koatty/koatty_serve/commit/f94a92a))
* docs: doc ([0ce3c88](https://github.com/koatty/koatty_serve/commit/0ce3c88))
* refactor: refactor ([2e4c375](https://github.com/koatty/koatty_serve/commit/2e4c375))



## <small>1.4.11 (2022-09-05)</small>

* build: v1.4.11 ([32b1bbc](https://github.com/koatty/koatty_serve/commit/32b1bbc))
* fix: upgrade deps ([f64725c](https://github.com/koatty/koatty_serve/commit/f64725c))



## <small>1.4.10 (2022-05-27)</small>

* build: update ([6f55611](https://github.com/koatty/koatty_serve/commit/6f55611))
* build: v1.4.10 ([882bee3](https://github.com/koatty/koatty_serve/commit/882bee3))



## <small>1.4.9 (2022-03-14)</small>

* 📃 docs: ([649c04c](https://github.com/koatty/koatty_serve/commit/649c04c))
* 🔧 build: v1.4.9 ([cd07fc3](https://github.com/koatty/koatty_serve/commit/cd07fc3))
* 🦄 refactor: ([6f2ada9](https://github.com/koatty/koatty_serve/commit/6f2ada9))



## <small>1.4.8 (2022-02-23)</small>

* 📃 docs: doc ([5637bf9](https://github.com/koatty/koatty_serve/commit/5637bf9))
* 🔧 build: v1.4.8 ([04e87a5](https://github.com/koatty/koatty_serve/commit/04e87a5))
* 🦄 refactor: ([2884333](https://github.com/koatty/koatty_serve/commit/2884333))



## <small>1.4.7 (2022-02-23)</small>

* 🔧 build: v1.4.7 ([ecfcf0d](https://github.com/koatty/koatty_serve/commit/ecfcf0d))
* 🔧 fix: processEvent类型约束 ([0a3d52a](https://github.com/koatty/koatty_serve/commit/0a3d52a))



## <small>1.4.6 (2022-02-16)</small>

* 💄 style: 格式 ([d93d3b4](https://github.com/koatty/koatty_serve/commit/d93d3b4))
* 🔧 build: v1.4.6 ([af9796a](https://github.com/koatty/koatty_serve/commit/af9796a))
* 🔧 build: 依赖 ([dc3ede2](https://github.com/koatty/koatty_serve/commit/dc3ede2))
* 🔧 build: 依赖 ([76b2b3d](https://github.com/koatty/koatty_serve/commit/76b2b3d))



## <small>1.4.4 (2021-12-23)</small>

* 🐞 fix: ([2f69fff](https://github.com/koatty/koatty_serve/commit/2f69fff))
* 🐞 fix:修改日志输出 ([eb5594c](https://github.com/koatty/koatty_serve/commit/eb5594c))
* 🐳 chore: ([522bf54](https://github.com/koatty/koatty_serve/commit/522bf54))
* 🔧 build: ([0ba2649](https://github.com/koatty/koatty_serve/commit/0ba2649))
* 🔧 build: v1.4.4 ([29b6094](https://github.com/koatty/koatty_serve/commit/29b6094))



## <small>1.4.2 (2021-12-20)</small>

* 🔧 build: v1.4.2 ([ae7b461](https://github.com/koatty/koatty_serve/commit/ae7b461))



## <small>1.4.2-0 (2021-12-18)</small>

* 📃 docs: ([e9aa97e](https://github.com/koatty/koatty_serve/commit/e9aa97e))
* 🔧 build: ([475de64](https://github.com/koatty/koatty_serve/commit/475de64))
* 🔧 build: v1.4.2-0 ([1fb8d8f](https://github.com/koatty/koatty_serve/commit/1fb8d8f))
* 🦄 refactor: ([6b2942a](https://github.com/koatty/koatty_serve/commit/6b2942a))



## <small>1.3.10 (2021-11-23)</small>

* chore(release): 1.3.10 ([2bafdec](https://github.com/koatty/koatty_serve/commit/2bafdec))
* 🐞 fix:修复ws 错误拦截 ([6a33db4](https://github.com/koatty/koatty_serve/commit/6a33db4))
* 🐳 chore: ([f33b3e1](https://github.com/koatty/koatty_serve/commit/f33b3e1))
* 🔧 build: ([13a9034](https://github.com/koatty/koatty_serve/commit/13a9034))



## <small>1.3.8 (2021-11-19)</small>

* chore(release): 1.3.8 ([4ef2a08](https://github.com/koatty/koatty_serve/commit/4ef2a08))



## <small>1.3.6 (2021-11-18)</small>

* chore(release): 1.3.6 ([83cfd78](https://github.com/koatty/koatty_serve/commit/83cfd78))
* ✨ feat: 支持 http https http2 ([be38981](https://github.com/koatty/koatty_serve/commit/be38981))
* ✨ feat: 支持grpc ([cbb4722](https://github.com/koatty/koatty_serve/commit/cbb4722))
* ✨ feat: 支持ws ([3b18175](https://github.com/koatty/koatty_serve/commit/3b18175))
* 🐞 fix: fix context fail ([5871eec](https://github.com/koatty/koatty_serve/commit/5871eec))



## <small>1.2.4 (2021-11-12)</small>

* chore(release): 1.2.4 ([e92f923](https://github.com/koatty/koatty_serve/commit/e92f923))



## <small>1.2.2 (2021-11-12)</small>

* chore(release): 1.2.2 ([054d054](https://github.com/koatty/koatty_serve/commit/054d054))
* ✨ feat: grpc server ([cc786a7](https://github.com/koatty/koatty_serve/commit/cc786a7))
* ✨ feat: websocket server ([f0f84e1](https://github.com/koatty/koatty_serve/commit/f0f84e1))



## <small>1.0.6 (2021-07-12)</small>

* chore(release): 1.0.6 ([246c0b6](https://github.com/koatty/koatty_serve/commit/246c0b6))
* 🐞 fix():使用core ([0e44b06](https://github.com/koatty/koatty_serve/commit/0e44b06))



## <small>1.0.4 (2021-07-07)</small>

* chore(release): 1.0.4 ([f6b8488](https://github.com/koatty/koatty_serve/commit/f6b8488))
* ✨ feat: 移除循环依赖 ([6665b86](https://github.com/koatty/koatty_serve/commit/6665b86))



## <small>1.0.3 (2021-06-29)</small>

* chore(release): 1.0.3 ([8da4fda](https://github.com/koatty/koatty_serve/commit/8da4fda))
* ✨ feat: support http2 ([7e3b828](https://github.com/koatty/koatty_serve/commit/7e3b828))



## <small>1.0.2 (2021-06-28)</small>

* chore(release): 1.0.2 ([6893bc5](https://github.com/koatty/koatty_serve/commit/6893bc5))



## <small>1.0.1 (2021-06-28)</small>

* chore(release): 1.0.1 ([70bd016](https://github.com/koatty/koatty_serve/commit/70bd016))
* Initial commit ([f98604a](https://github.com/koatty/koatty_serve/commit/f98604a))
