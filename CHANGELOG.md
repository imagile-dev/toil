# Changelog

## 0.1.0-alpha.1 (2026-10-17)


### ⚠ BREAKING CHANGES

* **db:** toil now needs Node 22.16 or later; it previously declared 22.12. Anyone on Node 22.12 to 22.15 should upgrade Node within the 22 line. Nothing else changes: config, flags and the envelope are untouched.
* the global --dry-run flag no longer exists; passing it is a usage error (INVALID_INPUT). Scripts that relied on it should run the command without --allow-write, which refuses the write.

### Features

* **ci:** post issue activity to Discord ([#11](https://github.com/imagile-dev/toil/issues/11)) ([3f05625](https://github.com/imagile-dev/toil/commit/3f0562544f26aaf70542bc1df58c93f347ab27c1))
* **ci:** review every PR with an agent ([#15](https://github.com/imagile-dev/toil/issues/15)) ([c7cbf5d](https://github.com/imagile-dev/toil/commit/c7cbf5d57f45578a7d4261c62d6233b01b793cac))
* **connections:** OS credential store and interactive setup ([#65](https://github.com/imagile-dev/toil/issues/65)) ([d8719d2](https://github.com/imagile-dev/toil/commit/d8719d237e7fb831bbee842c2c1476a4ba407c67))
* **core:** named connections, defineArea and file-based area registration ([#59](https://github.com/imagile-dev/toil/issues/59)) ([49b5cbf](https://github.com/imagile-dev/toil/commit/49b5cbfad8f3aded4475f1f9b7c151f8c6138fe2))
* **db:** db area with the SQLite provider ([#67](https://github.com/imagile-dev/toil/issues/67)) ([e979270](https://github.com/imagile-dev/toil/commit/e97927000ef05c155d386ef07be25b4ac1d44d27))
* **delivery:** a ship skill with local reviews and a 4-minute PR watch ([#98](https://github.com/imagile-dev/toil/issues/98)) ([9befd7c](https://github.com/imagile-dev/toil/commit/9befd7c1af383fc14777552c825eccdb29797057))
* foundation with one core behind the CLI and MCP ([#13](https://github.com/imagile-dev/toil/issues/13)) ([6733d44](https://github.com/imagile-dev/toil/commit/6733d440835fc002fbc2a1b40460e6352b6f29e2))
* **jira:** Jira Data Center integration ([#66](https://github.com/imagile-dev/toil/issues/66)) ([b3845e2](https://github.com/imagile-dev/toil/commit/b3845e296b69b04b19a480a93a1a57cd55a056c9))
* **site:** add the GitHub Pages site ([#3](https://github.com/imagile-dev/toil/issues/3)) ([63aa3a6](https://github.com/imagile-dev/toil/commit/63aa3a69236b87c11fe3d570d834701da869f4e3))
* **site:** How it works, per-integration docs, board deep links ([#19](https://github.com/imagile-dev/toil/issues/19)) ([454bcd4](https://github.com/imagile-dev/toil/commit/454bcd4a009e915c41de6c22574a87464c72edad))
* **welcome:** animated splash and main menu for bare toil ([#63](https://github.com/imagile-dev/toil/issues/63)) ([a437a73](https://github.com/imagile-dev/toil/commit/a437a738dcb542ab38402d49e8abe4ac7f3d85d9))


### Bug Fixes

* **ci:** leave latest alone when the dist-tag lookup fails ([#64](https://github.com/imagile-dev/toil/issues/64)) ([3504332](https://github.com/imagile-dev/toil/commit/35043329971071703577249537503d95371ae4e6))
* **ci:** open the release PR as the Imagile Bot App; release alphas before 1.0 ([#62](https://github.com/imagile-dev/toil/issues/62)) ([7e1ebc5](https://github.com/imagile-dev/toil/commit/7e1ebc58550743b411f5398d6f86f906a5d242d6))
* **test:** allow CHANGELOG.md at the repo root ([#100](https://github.com/imagile-dev/toil/issues/100)) ([bafa86d](https://github.com/imagile-dev/toil/commit/bafa86db7aa8c7f594d93f91b9edaedf6a969eeb))
