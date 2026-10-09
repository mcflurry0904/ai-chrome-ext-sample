# 车辆调度助手

三个目录，各做一件事：

- `tob-system`：某某车辆实时管理系统。数据写在浏览器本地，没有账号和后端。
- `extension`：Chrome 侧边栏。输入口令，调用代理，再用 playwright-crx 操作当前车辆系统。
- `agent`：LangChain + 火山方舟 Doubao-Seed-2.0-lite。把口令变成一组页面操作。

模型 ID 是 `doubao-seed-2-0-lite-260428`。`doubao-seed-2-0-lite-260215` 和 `doubao-seed-2.0-lite` 对本机的 API Key 返回找不到模型。需要换模型时设置 `VOLCENGINE_MODEL`。

## 启动

开三个终端，都在仓库根目录。

```powershell
python -m http.server 4173 --directory tob-system
```

```powershell
cd agent
uv sync
uv run uvicorn app:app --host 127.0.0.1 --port 8765
```

调度代理读取环境变量 `VOLCENGINE_API_KEY`。

```powershell
cd extension
npm install
npm run build
```

Chrome 打开 `chrome://extensions`，打开开发者模式，加载已解压的扩展，选择 `extension/dist`。

## 试一次

1. 点扩展图标，打开「调度口令」。
2. 保留示例口令「我想删掉昨天的车辆数据」，点「执行口令」。
3. 页面会打开 `http://127.0.0.1:4173/`，筛出昨天的三辆车并删除。
4. 顶部会出现「正在调试此浏览器」，留下它。
5. 想再试，先在车辆系统里点「恢复初始数据」。

另外两句可以直接点：

- 新增一辆车牌为京C55667的货车，司机赵铁柱，状态空闲
- 把苏E33058的状态改成维修中
