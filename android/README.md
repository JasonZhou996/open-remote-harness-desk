# Android 客户端

本项目的 Android WebView 客户端，与浏览器共用同一网关。源码在 `src/local/codex/lan/`，资源在 `res/`、`assets/`。支持局域网连接发现、网页会话恢复、附件传输、代理隧道和系统栏明暗主题。

连接页保留最近 10 个未收藏的连接，点击地址直接连接；点 ☆ 或“保存连接”可长期保留常用地址，长按地址可编辑或删除。每个连接分别记住密码，仅保存在本机。升级后自动保留旧版最后使用的地址和密码。

网页内使用系统返回键或返回手势可打开原生导航，平时不占页面空间。可切换 Codex／Claude Code／ZCode、前进后退、刷新或回到连接管理；网页未加载或 Harness 不可用时也能打开。原生切换会更新恢复记录，避免首页反复跳回之前不可用的 Harness。

## 构建

需要 JDK、Python 3，以及本机 Android SDK。当前脚本使用：

```text
$CODEX_ANDROID_SDK/
  build-tools/android-15/   aapt2、zipalign、lib/d8.jar、lib/apksigner.jar
  platform/android-35/      android.jar
```

`CODEX_ANDROID_SDK` 缺省为 `~/.local/share/codex-android-sdk`。按本机 SDK 目录设置后运行：

```bash
./android/build.sh
```

首次构建自动从 Google Maven 获取固定版本 AndroidX WebKit 1.5.0，校验归档 SHA-256 后提取 `lib/webkit-1.5.0.jar`。离线机器需提前准备同一依赖。

构建输出在 `android/dist/`。脚本使用本机 `signing.jks`；缺失时创建本地测试签名。升级已安装的客户端必须保留原签名文件。SDK、JAR、密钥、构建中间文件和 APK 都不提交到 Git。

`AddressCheck.java` 随构建执行；`ProxyTunnelCheck.java`、`TransferCheck.java`、`WorkspaceResumeCheck.mjs` 是现有协议检查。网页变化不需要重编 APK，原生桥变化才需要重新安装。
