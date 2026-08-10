#!/usr/bin/env node
// 版本号同步脚本:以 src-tauri/Cargo.toml 为唯一来源,
// 把版本号同步到 apps/desktop/package.json。
//
// 用法:node scripts/sync-version.mjs
// 或:  pnpm version:sync
//
// 设计:Cargo.toml 是 Tauri/Rust 的版本来源,tauri.conf.json 已删掉 version
// 字段(自动 fallback 到 Cargo.toml),所以只需再同步 package.json 即可。
// 以后发版只需改 Cargo.toml 里的 version,再跑一次本脚本即可全部同步。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoPath = join(root, "apps/desktop/src-tauri/Cargo.toml");
const pkgPath = join(root, "apps/desktop/package.json");

// 1. 从 Cargo.toml 读版本号
const cargo = readFileSync(cargoPath, "utf8");
const match = cargo.match(/^version\s*=\s*"([^"]+)"/m);
if (!match) {
  console.error("✗ 在 Cargo.toml 里没找到 version 字段");
  process.exit(1);
}
const version = match[1];

// 2. 读 package.json,如果版本一致就跳过
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
if (pkg.version === version) {
  console.log(`✓ 版本号已是 ${version},无需同步`);
  process.exit(0);
}

// 3. 写回 package.json(保留原有格式:2 空格缩进 + 末尾换行)
const oldVersion = pkg.version;
pkg.version = version;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`✓ 已同步:${oldVersion} → ${version}`);
console.log(`  Cargo.toml → apps/desktop/package.json`);
