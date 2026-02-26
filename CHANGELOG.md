# Change Log

## [0.2.42] - 2026-02-26

### 路由模块名解析优化

#### Bug 修复

- `**extractModuleName` 路径截取错误**：原逻辑对 `Work/SubPage/index` 格式路由取了两级路径（`Work/SubPage`），导致只扫描子目录、遗漏模块根目录下的公共文件；修复后统一只取第一级目录（`Work`）
- `**visitedDirs`（原 `iteratorDirArray`）不重置**：重新分析时旧数据未清空，导致子目录被永久跳过；修复后每次构建映射时自动重置，并从 WeakMap + 数组（O(n) 查找）改为 Set 复合键（O(1) 查找）
- `**rootModuleFileTags` 在根目录无文件时不注册**：若模块根目录下仅有子目录，深层嵌套文件无法通过父目录查找模块名；修复后在 `mapModuleFiles` 入口处立即注册，并新增 `findModuleNamesForDir` 向上递归查找祖先目录
- `**findMatchingRoute` 分支 bug**：当 `component` 含显式 `index`（如 `Work/SubPage/index`）且文件也是 `index.tsx` 时，错误进入第二分支拼接成 `Work/SubPage/index/index` 导致路由匹配失败；重写为两种模式（直接匹配 + 目录 index 匹配），提取 `componentToAbsPath` 统一处理 `@/`、`./` 等路径前缀
- `**watchFileChanges` glob 在 Windows 失效**：路径分隔符使用了 `path.sep`，Windows 下生成 `\` 导致 VS Code 文件监听失败；改为固定 `/`

#### 功能改进

- **多路由共享模块文件的模块名合并**：同一目录被多个路由扫描时，`visitedDirs` 改用 `moduleName::dirPath` 复合键，允许各路由独立递归，公共文件合并所有相关路由的模块名
- **新增依赖图传播（`propagateModuleNamesViaDependencies`）**：以直接路由匹配的文件为种子，沿 import 方向单向 BFS 传播，精确推断每个文件所属的路由模块
  - 只沿 `dependencies`（import 方向）传播，不走 `dependents`（被 import 方向），避免 Layout / 父路由等文件被错误标记
  - 按 import 跳数排序：0 跳 / 唯一可达时写入单一路由名；多路由可达时取跳数最小的前 3 个
  - 传播结束后同步更新全部路由字段：`moduleNames`、`routePath`、`title`、`access`、`hideInMenu`（以跳数最近的路由配置为准）
- **清理所有遗留调试 `console.log`**，统一改为 `logger`

---

## [0.2.1] - 2026-02-25

- 支持工作区目录的项目路由解析
- 支持文件引用关系信息展示
- 优化相关路由索引

## [0.1.4] - 2024-11-21

- fix file map when parent dir not have right route map

## [0.1.3] - 2024-11-05 pm

- add more route infomation

## [0.1.2] - 2024-11-05

- update deep file parse function

## [0.1.0] - 2024-11-05

- modify version to 0.1.0
- update the extension name and description

## [0.0.2] - 2024-11-05

- fix the module name parsing error
- optimize the module name parsing logic
- update extension icon

## [0.0.1] - 2024-10-30

- init project
- add module name parsing function
- add route name parsing function
- add module name and route name mapping function

