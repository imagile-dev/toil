# Changelog

## [0.1.0-alpha.2](https://github.com/imagile-dev/toil/compare/toil-ui-v0.1.0-alpha.1...toil-ui-v0.1.0-alpha.2) (2026-10-20)


### Features

* **ado-cloud:** read a team's sprints, backlogs, boards and work item type states ([#331](https://github.com/imagile-dev/toil/issues/331)) ([eec14da](https://github.com/imagile-dev/toil/commit/eec14da286fa5657de0293981fd630545a282fae))
* one command shape for jira and ado, and a Services menu ([#310](https://github.com/imagile-dev/toil/issues/310)) ([fae6921](https://github.com/imagile-dev/toil/commit/fae6921ddd942affdfb0cc4aa1dde4783992fee1))
* OWI for GitHub without a board: milestones as sprints, estimate labels and links ([#324](https://github.com/imagile-dev/toil/issues/324)) ([55f6404](https://github.com/imagile-dev/toil/commit/55f640467b7304040481726deda5c7cc8acdbb56))
* pull request tracking in Toil UI across GitHub, Bitbucket and Azure DevOps ([#334](https://github.com/imagile-dev/toil/issues/334)) ([49ece25](https://github.com/imagile-dev/toil/commit/49ece25ff479c5635318b714da1846948e806ad2))
* seed an Azure DevOps Services board from OWI, test ado-cloud on it, and run Toil UI on it ([#327](https://github.com/imagile-dev/toil/issues/327)) ([e2d0b60](https://github.com/imagile-dev/toil/commit/e2d0b6064e517220236c2c20522b4164610de6b9))
* the command shape for every remaining integration ([#323](https://github.com/imagile-dev/toil/issues/323)) ([323c40c](https://github.com/imagile-dev/toil/commit/323c40cd3d94646443cd5e3877b7d5e7f00f04f3))
* the dog-eared badge as toil's mark, an orbit splash, and a badge per Toil UI theme ([#282](https://github.com/imagile-dev/toil/issues/282)) ([4e1e0ce](https://github.com/imagile-dev/toil/commit/4e1e0ce7a512ce11deb5af0c6fa83c95a273037e))
* toil audit stats, and a Usage of toil page in Toil UI ([#329](https://github.com/imagile-dev/toil/issues/329)) ([7299292](https://github.com/imagile-dev/toil/commit/7299292e6af41794855cd3aed713f268f3e35d68))
* transitions by intent, resolved against each item's own workflow ([#322](https://github.com/imagile-dev/toil/issues/322)) ([e155760](https://github.com/imagile-dev/toil/commit/e155760b2e31ed8d2a1ce8edf85a5bd143cfe7d7))
* **ui:** a daily worklog per dossier, folded from the sync, pull requests, builds and agent runs ([#338](https://github.com/imagile-dev/toil/issues/338)) ([88e813f](https://github.com/imagile-dev/toil/commit/88e813fc42d7613f7891431db91627f6210a4da3))
* **ui:** a People view of what each person and agent is working on ([#336](https://github.com/imagile-dev/toil/issues/336)) ([2fc9178](https://github.com/imagile-dev/toil/commit/2fc917849c503367ff7be0eb2a8a317c11d819d4))
* **ui:** a refined, grimdark Realm theme ([#357](https://github.com/imagile-dev/toil/issues/357)) ([ed9b18e](https://github.com/imagile-dev/toil/commit/ed9b18e349e427d663012905d501aadb0e35e80e))
* **ui:** assign work items to an agent, in refine, investigate and implement modes ([#341](https://github.com/imagile-dev/toil/issues/341)) ([8033f55](https://github.com/imagile-dev/toil/commit/8033f55ca09a33a22a27adf6db3537e06c36e6c6))
* **ui:** npm run verify:ui, Codex in a home of its own, and the lockfile held to the pin ([#325](https://github.com/imagile-dev/toil/issues/325)) ([7f9fc73](https://github.com/imagile-dev/toil/commit/7f9fc73dbfaf5fdc48215c7e1beded4ee02ef410))
* **ui:** per-chat model usage from the Claude, Codex and Copilot SDKs, with optional caps ([#337](https://github.com/imagile-dev/toil/issues/337)) ([9d4e94c](https://github.com/imagile-dev/toil/commit/9d4e94cb4ecb6c4366e7204efa0eba82f2ee2273))
* **ui:** the readiness gate and a read-only Command Center ([#351](https://github.com/imagile-dev/toil/issues/351)) ([a37e707](https://github.com/imagile-dev/toil/commit/a37e70785f002e4ff58a16ab3216119efb6052c4))
* **ui:** theme depth: themed wording, the agent's voice and your own instructions ([#284](https://github.com/imagile-dev/toil/issues/284)) ([f05630e](https://github.com/imagile-dev/toil/commit/f05630e937200030ccd75f7dbd1eca268beb29d5))
* **ui:** Toil UI on real data, bare bones ([#315](https://github.com/imagile-dev/toil/issues/315)) ([3a8d3d5](https://github.com/imagile-dev/toil/commit/3a8d3d5fd35b96ce94c47fb8b4874487bb34de42))
* util owi similar finds likely duplicate work items, offline and deterministic ([#316](https://github.com/imagile-dev/toil/issues/316)) ([dc56487](https://github.com/imagile-dev/toil/commit/dc564873667ab68b0521f2da2075e92c7a7b6cf3))


### Bug Fixes

* **core:** refuse UNC paths before any file access, and validate and encode ids used in API paths ([#352](https://github.com/imagile-dev/toil/issues/352)) ([95b4012](https://github.com/imagile-dev/toil/commit/95b40120062f007b68842df0f897a6dba0d67892))
* **ui:** run verify:ui and dev-real on toil built from this checkout ([#335](https://github.com/imagile-dev/toil/issues/335)) ([51ac386](https://github.com/imagile-dev/toil/commit/51ac386948db17ef393e06e5dff5aad0e5421dec))
* **ui:** Toil UI tests stop timing out on Windows runners ([#330](https://github.com/imagile-dev/toil/issues/330)) ([01c324d](https://github.com/imagile-dev/toil/commit/01c324d7b7f0e6b02988ada74760cdc34256092f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @imagile-dev/toil bumped from 0.1.0-alpha.3 to 0.1.0-alpha.4

## 0.1.0-alpha.1 (2026-10-19)


### Features

* consented feedback from the site, the API, toil feedback and Toil UI ([#270](https://github.com/imagile-dev/toil/issues/270)) ([ba6a558](https://github.com/imagile-dev/toil/commit/ba6a5582a703da95b5378fcc77d63b857c075f11))
* playful wordmark across the site, Toil UI and the CLI ([#274](https://github.com/imagile-dev/toil/issues/274)) ([913e7bf](https://github.com/imagile-dev/toil/commit/913e7bfda433f649fd758f9ae9934139fdffb74b))
* **ui:** agent adapters for Claude, Copilot and Codex ([#260](https://github.com/imagile-dev/toil/issues/260)) ([48c8748](https://github.com/imagile-dev/toil/commit/48c87480f4fbf397e5f421a61408e20732ccff43))
* **ui:** board, flow, dependency graph, insights, charts and a docked chat ([#255](https://github.com/imagile-dev/toil/issues/255)) ([70e4bd2](https://github.com/imagile-dev/toil/commit/70e4bd2e82fb7945f8f34f2714fae52e50e8e7d6))
* **ui:** generated art for the game themes ([#269](https://github.com/imagile-dev/toil/issues/269)) ([e919f36](https://github.com/imagile-dev/toil/commit/e919f364ee0b096699a5d5d586a191d92f4c8a6f))
* **ui:** Harvest, Starship and Realm themes ([#259](https://github.com/imagile-dev/toil/issues/259)) ([cb78b63](https://github.com/imagile-dev/toil/commit/cb78b6369d3247bc843b2a96a52ae9d45491352d))
* **ui:** motion and life for the game themes ([#275](https://github.com/imagile-dev/toil/issues/275)) ([552ab20](https://github.com/imagile-dev/toil/commit/552ab204231fbdd11b890b0987bd65196abe136e))
* **ui:** one dashboard per dossier, fed by a fixture execute() ([#229](https://github.com/imagile-dev/toil/issues/229)) ([01a4e39](https://github.com/imagile-dev/toil/commit/01a4e395450ccfaeaa0ae34cdf740c8679fb10f7))
* **ui:** settings pages for toil's connections and dossiers, through ./api ([#258](https://github.com/imagile-dev/toil/issues/258)) ([dd37791](https://github.com/imagile-dev/toil/commit/dd37791dc3e1590d58633be74901e2b788c3cffd))
* **ui:** sync into a local SQLite cache through ./api ([#257](https://github.com/imagile-dev/toil/issues/257)) ([b8ede69](https://github.com/imagile-dev/toil/commit/b8ede69f761f247b50f00f9f2134d08a7c42ecbe))
* **ui:** the @imagile-dev/toil-ui package and its local server ([#254](https://github.com/imagile-dev/toil/issues/254)) ([40f4698](https://github.com/imagile-dev/toil/commit/40f46987023fd89f41c604bad5a328815a19b0e3))
* **ui:** Toil UI site preview on a fixture Store and a scripted Agent ([#227](https://github.com/imagile-dev/toil/issues/227)) ([b33ab70](https://github.com/imagile-dev/toil/commit/b33ab70600fcca990f3b58966de35c192f29f4f5))


### Bug Fixes

* layout primitives, an overflow check, and the UI and site sweep fixes ([#280](https://github.com/imagile-dev/toil/issues/280)) ([44aa883](https://github.com/imagile-dev/toil/commit/44aa88396c054373b34e8c6202115b75902bc613))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @imagile-dev/toil bumped from 0.1.0-alpha.2 to 0.1.0-alpha.3
