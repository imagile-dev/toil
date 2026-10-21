# Changelog

## [0.1.0-alpha.5](https://github.com/imagile-dev/toil/compare/v0.1.0-alpha.4...v0.1.0-alpha.5) (2026-10-21)


### Features

* onboard to a repo's dossiers, match connections by host, and shareable dossiers by default ([#369](https://github.com/imagile-dev/toil/issues/369)) ([797e884](https://github.com/imagile-dev/toil/commit/797e88422c7f3ec88b261da998dd70209e65d5ef))
* show that a pasted secret arrived, and check the paste, on the CLI and in Toil UI ([#370](https://github.com/imagile-dev/toil/issues/370)) ([d88684d](https://github.com/imagile-dev/toil/commit/d88684d4edb45ace5a056e6a138b01e5a3d79b29))
* **site:** a Toil UI showcase at /ui/ that frames the real app and shows how themes change the prompts ([#386](https://github.com/imagile-dev/toil/issues/386)) ([2136d9e](https://github.com/imagile-dev/toil/commit/2136d9eb05f54d7d718d6ea1222727df14ae6c98))
* ticket the work before starting it, in the skill and in Toil UI's chat ([#367](https://github.com/imagile-dev/toil/issues/367)) ([60f5e48](https://github.com/imagile-dev/toil/commit/60f5e488919f9d77888a211cbd1429db8ca47f49))
* **ui:** a particle switch for every theme, and Fredoka in Plain ([#356](https://github.com/imagile-dev/toil/issues/356)) ([d5c9902](https://github.com/imagile-dev/toil/commit/d5c9902653c284058ab2fc88488555a6b4ae1509))
* **ui:** a stand-up report folded from the worklog, by person, with an optional agent write-up ([#360](https://github.com/imagile-dev/toil/issues/360)) ([a7cf3db](https://github.com/imagile-dev/toil/commit/a7cf3dbc313b0e2c09fb515deb747d1b1efac830))
* **ui:** Ask up front with live status and Analyze; switch agents live and install an approved SDK in one press ([#378](https://github.com/imagile-dev/toil/issues/378)) ([3b82ae2](https://github.com/imagile-dev/toil/commit/3b82ae218a51c3736be507f75f406beb31e227b5))
* **ui:** dossier pages that preview the work, and a dossier's name and description edited in place ([#371](https://github.com/imagile-dev/toil/issues/371)) ([67840ef](https://github.com/imagile-dev/toil/commit/67840ef7405d1414aae2374c06faf941c0faa4b3))
* **ui:** drag the whole board card, with its moves in a context menu ([#375](https://github.com/imagile-dev/toil/issues/375)) ([e65d18c](https://github.com/imagile-dev/toil/commit/e65d18c04327455f30971e2d2fa13ff68183b74f)), closes [#347](https://github.com/imagile-dev/toil/issues/347)
* **ui:** notify on agent state changes, never on events ([#382](https://github.com/imagile-dev/toil/issues/382)) ([ca54072](https://github.com/imagile-dev/toil/commit/ca54072b513421771cfb7a6eacf0e818b1476d0a))
* **ui:** stale sessions, recorded fingerprints and one-click renew ([#381](https://github.com/imagile-dev/toil/issues/381)) ([045fc5c](https://github.com/imagile-dev/toil/commit/045fc5c8ccda9a1797b446e635b0493bc5a0f1f6))
* **ui:** tooltips with Read more links, and edit links to configuration ([#383](https://github.com/imagile-dev/toil/issues/383)) ([f065710](https://github.com/imagile-dev/toil/commit/f0657101a21abe0b489c4b99ae4f500a4d905eb2))


### Bug Fixes

* **ci:** Linux gates on PRs, other platforms daily, and a parallel layout check ([#377](https://github.com/imagile-dev/toil/issues/377)) ([74e44da](https://github.com/imagile-dev/toil/commit/74e44dab5fdbf9b02a53fbdbbf00f3c3d97ad99f))
* **ci:** re-approve merge-only pushes without a full review, and one decision file per PR ([#368](https://github.com/imagile-dev/toil/issues/368)) ([c0729e7](https://github.com/imagile-dev/toil/commit/c0729e7bf6ac2803a85ff6959431160da7fb9f13))
* **ci:** wait up to 15 minutes for npm to serve a new toil after a release ([#365](https://github.com/imagile-dev/toil/issues/365)) ([0fafe17](https://github.com/imagile-dev/toil/commit/0fafe17a11e2c2b1a9763bddd1962a3d22880908))
* **site:** let docs tables wrap to the screen on phones ([#389](https://github.com/imagile-dev/toil/issues/389)) ([d4bceec](https://github.com/imagile-dev/toil/commit/d4bceec0a8755c472bff92fd1d1fa652c1d6663c)), closes [#388](https://github.com/imagile-dev/toil/issues/388)
* **test:** pin the frozen decisions archive to main's actual content ([#373](https://github.com/imagile-dev/toil/issues/373)) ([0230e2d](https://github.com/imagile-dev/toil/commit/0230e2d1d87f5be2ce0f8fb224bc85a0b4f47a93)), closes [#372](https://github.com/imagile-dev/toil/issues/372)
* **ui:** Copilot's agent features verified live, with the five fixes they needed ([#384](https://github.com/imagile-dev/toil/issues/384)) ([69746c9](https://github.com/imagile-dev/toil/commit/69746c9ea858f8d20e21682fd3c9480dd471aa97))
* **ui:** hold only the sample data's header to the 1440px row ([#391](https://github.com/imagile-dev/toil/issues/391)) ([a0ed41a](https://github.com/imagile-dev/toil/commit/a0ed41a1660470faf07ed3bc5987b148c1d4242b))
* **ui:** show Plain's full header row at desktop widths ([#390](https://github.com/imagile-dev/toil/issues/390)) ([dff97b3](https://github.com/imagile-dev/toil/commit/dff97b3de0cda43eddfb1fd784f394b477a4a35d)), closes [#387](https://github.com/imagile-dev/toil/issues/387)

## [0.1.0-alpha.4](https://github.com/imagile-dev/toil/compare/v0.1.0-alpha.3...v0.1.0-alpha.4) (2026-10-20)


### Features

* **ado-cloud:** read a team's sprints, backlogs, boards and work item type states ([#331](https://github.com/imagile-dev/toil/issues/331)) ([eec14da](https://github.com/imagile-dev/toil/commit/eec14da286fa5657de0293981fd630545a282fae))
* **db:** a dialect pre-flight lint before SQL runs, and toil db lint ([#314](https://github.com/imagile-dev/toil/issues/314)) ([d693d33](https://github.com/imagile-dev/toil/commit/d693d33ad138f709ef764b3d84c7a16ffadbd2a1))
* one command shape for jira and ado, and a Services menu ([#310](https://github.com/imagile-dev/toil/issues/310)) ([fae6921](https://github.com/imagile-dev/toil/commit/fae6921ddd942affdfb0cc4aa1dde4783992fee1))
* OWI for GitHub without a board: milestones as sprints, estimate labels and links ([#324](https://github.com/imagile-dev/toil/issues/324)) ([55f6404](https://github.com/imagile-dev/toil/commit/55f640467b7304040481726deda5c7cc8acdbb56))
* pull request tracking in Toil UI across GitHub, Bitbucket and Azure DevOps ([#334](https://github.com/imagile-dev/toil/issues/334)) ([49ece25](https://github.com/imagile-dev/toil/commit/49ece25ff479c5635318b714da1846948e806ad2))
* seed an Azure DevOps Services board from OWI, test ado-cloud on it, and run Toil UI on it ([#327](https://github.com/imagile-dev/toil/issues/327)) ([e2d0b60](https://github.com/imagile-dev/toil/commit/e2d0b6064e517220236c2c20522b4164610de6b9))
* size-aware output for agents, --output-format toon and --summary-file ([#321](https://github.com/imagile-dev/toil/issues/321)) ([f222f39](https://github.com/imagile-dev/toil/commit/f222f39721a94e48a5b8bc0ab3bf95aa305d754f))
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

* **core:** bound --select results, build dossier sections without prototypes, and compile .gitignore patterns in linear time ([#354](https://github.com/imagile-dev/toil/issues/354)) ([cc2950f](https://github.com/imagile-dev/toil/commit/cc2950f202b21e590d45551b951e90df468c5682))
* **core:** carry object projections through every field, and warn on an unreadable .gitignore ([#312](https://github.com/imagile-dev/toil/issues/312)) ([7b580b4](https://github.com/imagile-dev/toil/commit/7b580b4dafd348ea7a602dee86fadfe7af04c407))
* **core:** refuse UNC paths before any file access, and validate and encode ids used in API paths ([#352](https://github.com/imagile-dev/toil/issues/352)) ([95b4012](https://github.com/imagile-dev/toil/commit/95b40120062f007b68842df0f897a6dba0d67892))
* **feedback:** redact reports before the issue is created ([#350](https://github.com/imagile-dev/toil/issues/350)) ([877950d](https://github.com/imagile-dev/toil/commit/877950dd1cd12c51c720459c9e1f035276c4fd03))
* **triage:** check for duplicates of any earlier issue first, and read why a denial was made ([#311](https://github.com/imagile-dev/toil/issues/311)) ([8442681](https://github.com/imagile-dev/toil/commit/844268135fa9c2ca5b56cfbb8705cce50365e8c2))
* **ui:** run verify:ui and dev-real on toil built from this checkout ([#335](https://github.com/imagile-dev/toil/issues/335)) ([51ac386](https://github.com/imagile-dev/toil/commit/51ac386948db17ef393e06e5dff5aad0e5421dec))
* **ui:** Toil UI tests stop timing out on Windows runners ([#330](https://github.com/imagile-dev/toil/issues/330)) ([01c324d](https://github.com/imagile-dev/toil/commit/01c324d7b7f0e6b02988ada74760cdc34256092f))

## [0.1.0-alpha.3](https://github.com/imagile-dev/toil/compare/v0.1.0-alpha.2...v0.1.0-alpha.3) (2026-10-19)


### Features

* consented feedback from the site, the API, toil feedback and Toil UI ([#270](https://github.com/imagile-dev/toil/issues/270)) ([ba6a558](https://github.com/imagile-dev/toil/commit/ba6a5582a703da95b5378fcc77d63b857c075f11))
* playful wordmark across the site, Toil UI and the CLI ([#274](https://github.com/imagile-dev/toil/issues/274)) ([913e7bf](https://github.com/imagile-dev/toil/commit/913e7bfda433f649fd758f9ae9934139fdffb74b))
* **ui:** agent adapters for Claude, Copilot and Codex ([#260](https://github.com/imagile-dev/toil/issues/260)) ([48c8748](https://github.com/imagile-dev/toil/commit/48c87480f4fbf397e5f421a61408e20732ccff43))
* **ui:** board, flow, dependency graph, insights, charts and a docked chat ([#255](https://github.com/imagile-dev/toil/issues/255)) ([70e4bd2](https://github.com/imagile-dev/toil/commit/70e4bd2e82fb7945f8f34f2714fae52e50e8e7d6))
* **ui:** generated art for the game themes ([#269](https://github.com/imagile-dev/toil/issues/269)) ([e919f36](https://github.com/imagile-dev/toil/commit/e919f364ee0b096699a5d5d586a191d92f4c8a6f))
* **ui:** Harvest, Starship and Realm themes ([#259](https://github.com/imagile-dev/toil/issues/259)) ([cb78b63](https://github.com/imagile-dev/toil/commit/cb78b6369d3247bc843b2a96a52ae9d45491352d))
* **ui:** motion and life for the game themes ([#275](https://github.com/imagile-dev/toil/issues/275)) ([552ab20](https://github.com/imagile-dev/toil/commit/552ab204231fbdd11b890b0987bd65196abe136e))
* **ui:** settings pages for toil's connections and dossiers, through ./api ([#258](https://github.com/imagile-dev/toil/issues/258)) ([dd37791](https://github.com/imagile-dev/toil/commit/dd37791dc3e1590d58633be74901e2b788c3cffd))
* **ui:** sync into a local SQLite cache through ./api ([#257](https://github.com/imagile-dev/toil/issues/257)) ([b8ede69](https://github.com/imagile-dev/toil/commit/b8ede69f761f247b50f00f9f2134d08a7c42ecbe))
* **ui:** the @imagile-dev/toil-ui package and its local server ([#254](https://github.com/imagile-dev/toil/issues/254)) ([40f4698](https://github.com/imagile-dev/toil/commit/40f46987023fd89f41c604bad5a328815a19b0e3))


### Bug Fixes

* **core:** match .gitignore globs in linear time ([#261](https://github.com/imagile-dev/toil/issues/261)) ([f591a01](https://github.com/imagile-dev/toil/commit/f591a01efd00989683340f268f050979e8750d9f))
* **core:** skip only the bad .gitignore line, with a warning ([#263](https://github.com/imagile-dev/toil/issues/263)) ([5af61c8](https://github.com/imagile-dev/toil/commit/5af61c85ed7a9851aa1077a1eec1218c711bcd62))
* layout primitives, an overflow check, and the UI and site sweep fixes ([#280](https://github.com/imagile-dev/toil/issues/280)) ([44aa883](https://github.com/imagile-dev/toil/commit/44aa88396c054373b34e8c6202115b75902bc613))

## [0.1.0-alpha.2](https://github.com/imagile-dev/toil/compare/v0.1.0-alpha.1...v0.1.0-alpha.2) (2026-10-19)


### Features

* **util:** run --grep, md conversion, size outlines and YAML parsing in the bounded worker ([#243](https://github.com/imagile-dev/toil/issues/243)) ([1ff323b](https://github.com/imagile-dev/toil/commit/1ff323bd2e913e42779740a4bb871f64433ab215))


### Bug Fixes

* **triage:** install bubblewrap for the agent's isolation, and clear failure labels on a decision ([#242](https://github.com/imagile-dev/toil/issues/242)) ([b20bb4f](https://github.com/imagile-dev/toil/commit/b20bb4f106effdc8cfafbed4c975bea1b2d1eb6b))

## 0.1.0-alpha.1 (2026-10-18)


### Features

* **ado-cloud:** add Azure DevOps Services integration beside Azure DevOps Server ([#225](https://github.com/imagile-dev/toil/issues/225)) ([c9032e2](https://github.com/imagile-dev/toil/commit/c9032e2f9bc33566d8791c3977363eeb252ee961))
* **ado:** add the Azure DevOps Server integration ([#144](https://github.com/imagile-dev/toil/issues/144)) ([5ca6d5d](https://github.com/imagile-dev/toil/commit/5ca6d5d63891390ba86d907b2390d409ae7a6e78))
* **ado:** page every list through meta.page, add --updated-since, work revisions and work get-batch ([#216](https://github.com/imagile-dev/toil/issues/216)) ([be379e4](https://github.com/imagile-dev/toil/commit/be379e4dd9bd185546723949c5524458d307122f))
* **alation:** add the Alation integration ([#133](https://github.com/imagile-dev/toil/issues/133)) ([63ac419](https://github.com/imagile-dev/toil/commit/63ac419da05ae818a9351af34cfc7dfb5edb1ec5))
* **artifactory:** add the JFrog Artifactory integration ([#118](https://github.com/imagile-dev/toil/issues/118)) ([885caf4](https://github.com/imagile-dev/toil/commit/885caf411286e4a1cd16766eaa56bc16563bd6f6))
* **bitbucket-cloud:** add Bitbucket Cloud integration beside Bitbucket Data Center ([#204](https://github.com/imagile-dev/toil/issues/204)) ([1b01f47](https://github.com/imagile-dev/toil/commit/1b01f47c3935acd83ea9a9cf871129905532a8eb))
* **bitbucket:** add the Bitbucket Data Center integration ([#120](https://github.com/imagile-dev/toil/issues/120)) ([5884923](https://github.com/imagile-dev/toil/commit/5884923fd589b948ac85fa4b705a1857e3f5157d))
* **checkmarx:** add the Checkmarx One integration ([#129](https://github.com/imagile-dev/toil/issues/129)) ([bf3e2e7](https://github.com/imagile-dev/toil/commit/bf3e2e79dcd1081625262254e4769aa8ac84e4f5))
* **ci:** post issue activity to Discord ([#11](https://github.com/imagile-dev/toil/issues/11)) ([6e40b5a](https://github.com/imagile-dev/toil/commit/6e40b5aedea02b0070fb33c4c5e23d21318ff78c))
* **ci:** review every PR with an agent ([#15](https://github.com/imagile-dev/toil/issues/15)) ([8fa08a8](https://github.com/imagile-dev/toil/commit/8fa08a8c06108a5d587f66f43fe40faf4d750ebd))
* **confluence-cloud:** add the Confluence Cloud integration ([#147](https://github.com/imagile-dev/toil/issues/147)) ([68c6bdd](https://github.com/imagile-dev/toil/commit/68c6bdd02149d97a70e388a4b51517b157622f54))
* **confluence:** add the Confluence Data Center integration ([#117](https://github.com/imagile-dev/toil/issues/117)) ([a515f5e](https://github.com/imagile-dev/toil/commit/a515f5e4b5734a3261a3c75a2982fc4298c4ae93))
* **connections:** OS credential store and interactive setup ([#65](https://github.com/imagile-dev/toil/issues/65)) ([0001854](https://github.com/imagile-dev/toil/commit/00018549e40241d1bde51db01d3fbbc15796c1b1))
* **contrast:** add the Contrast Security integration ([#123](https://github.com/imagile-dev/toil/issues/123)) ([e16138a](https://github.com/imagile-dev/toil/commit/e16138ab8a285364d77b0656dc0902701a659ff2))
* **core:** @imagile-dev/toil/api, contractVersion, read-only calls and progress events ([#219](https://github.com/imagile-dev/toil/issues/219)) ([ade67b1](https://github.com/imagile-dev/toil/commit/ade67b171c9000b982d51092fbaba2292d8f6f7c))
* **core:** add --select, a JMESPath expression applied to data ([#151](https://github.com/imagile-dev/toil/issues/151)) ([5f51c81](https://github.com/imagile-dev/toil/commit/5f51c819adc8f50806166e1158b2643c7fb0e4b0))
* **core:** add &lt;area&gt; api, a raw API passthrough, for Jira Data Center first ([#157](https://github.com/imagile-dev/toil/issues/157)) ([cbd475b](https://github.com/imagile-dev/toil/commit/cbd475bfa94d16322b090aed8b0c5f7f8f4dfc6a))
* **core:** add a local audit log of every command, with toil audit list and path ([#168](https://github.com/imagile-dev/toil/issues/168)) ([6560371](https://github.com/imagile-dev/toil/commit/6560371e84dff52aad5bcdbad4322366cf7e95b4))
* **core:** add toil wait and MCP resources ([#171](https://github.com/imagile-dev/toil/issues/171)) ([42e319d](https://github.com/imagile-dev/toil/commit/42e319d38cb27cb5b178b5c95a5ed48b6440d1bd))
* **core:** area API for the integration kit (K1) ([#104](https://github.com/imagile-dev/toil/issues/104)) ([765a76d](https://github.com/imagile-dev/toil/commit/765a76d443a68b2ce909b6a69210731214a267ef))
* **core:** close the integration-kit gaps the Jira and SonarQube pilots found ([#113](https://github.com/imagile-dev/toil/issues/113)) ([063585c](https://github.com/imagile-dev/toil/commit/063585c06340072c8a1cf1d3cb7f97bc025de7e2))
* **core:** file workspace, bounds, and git in pure JS with a safeguarded spawner ([#106](https://github.com/imagile-dev/toil/issues/106)) ([683e47a](https://github.com/imagile-dev/toil/commit/683e47a6cedafac82666665d8838aa327b09489f))
* **core:** HTTP layer for the integration kit (K2) ([#105](https://github.com/imagile-dev/toil/issues/105)) ([b3e2d4e](https://github.com/imagile-dev/toil/commit/b3e2d4ee6b467c38cdee0c5408f1b87da0ac5047))
* **core:** named connections, defineArea and file-based area registration ([#59](https://github.com/imagile-dev/toil/issues/59)) ([1bdd151](https://github.com/imagile-dev/toil/commit/1bdd15181694506c23d875b77c10323cda8a8fd7))
* **core:** second batch of integration-kit fixes (KF2) ([#128](https://github.com/imagile-dev/toil/issues/128)) ([b0182ac](https://github.com/imagile-dev/toil/commit/b0182ac232bbba4688cd6220b50b0fd3fe434138))
* **db:** add the MySQL / MariaDB provider ([#156](https://github.com/imagile-dev/toil/issues/156)) ([5ed4dce](https://github.com/imagile-dev/toil/commit/5ed4dcee02d66b4eb71dfed6f0d1387b4514f898))
* **db:** add the Oracle provider (oracledb in Thin mode) ([#162](https://github.com/imagile-dev/toil/issues/162)) ([e8ed662](https://github.com/imagile-dev/toil/commit/e8ed6626cc8e39b4628bfea4fa4073d8943ed3b9))
* **db:** add the PostgreSQL provider ([#150](https://github.com/imagile-dev/toil/issues/150)) ([43ed7c1](https://github.com/imagile-dev/toil/commit/43ed7c108cc0b472ca4a2b8de58ba99286a9f6d7))
* **db:** add the SQL Server provider (SQL logins) ([#160](https://github.com/imagile-dev/toil/issues/160)) ([2c617a2](https://github.com/imagile-dev/toil/commit/2c617a2b7b3a781a95b21c16f804f2e4a292b8c8))
* **db:** add Windows authentication for SQL Server ([#165](https://github.com/imagile-dev/toil/issues/165)) ([61d239c](https://github.com/imagile-dev/toil/commit/61d239c2b2159a244c6cffbd7dc85b24cc7a1fa7))
* **db:** db area with the SQLite provider ([#67](https://github.com/imagile-dev/toil/issues/67)) ([9e2845d](https://github.com/imagile-dev/toil/commit/9e2845d7cc84a8324433d4c67bf32fe4ca296f58))
* **delivery:** a ship skill with local reviews and a 4-minute PR watch ([#98](https://github.com/imagile-dev/toil/issues/98)) ([df56e96](https://github.com/imagile-dev/toil/commit/df56e96e2797a7020b29899ffe1304154a03e87f))
* **dossiers:** build and share dossiers, scan for repos, check against services ([#164](https://github.com/imagile-dev/toil/issues/164)) ([e356b14](https://github.com/imagile-dev/toil/commit/e356b14ed3db2807e553c5e9b622b847433dbaee))
* **dossiers:** check-dossier for ado, openshift, dynatrace, bitbucket, github and jira-cloud ([#170](https://github.com/imagile-dev/toil/issues/170)) ([450fdd3](https://github.com/imagile-dev/toil/commit/450fdd3e8ea0b494034e94c6bacda1af4345c333))
* **dossiers:** read dossiers and resolve context from them ([#152](https://github.com/imagile-dev/toil/issues/152)) ([2c5f0b0](https://github.com/imagile-dev/toil/commit/2c5f0b0fd4b0d72c86b6a06ad487229f779b3658))
* **dynatrace:** add the Dynatrace integration ([#126](https://github.com/imagile-dev/toil/issues/126)) ([0511770](https://github.com/imagile-dev/toil/commit/05117700341f3a8bc3475965a9225214f72768b4))
* **elasticsearch:** add the Elasticsearch integration from Elastic's REST API docs ([#121](https://github.com/imagile-dev/toil/issues/121)) ([094cb44](https://github.com/imagile-dev/toil/commit/094cb44ac60c6481e69717ee28d87a207b468eac))
* feedback backend, curl endpoint, capped triage, and toil version's commit ([#226](https://github.com/imagile-dev/toil/issues/226)) ([dd66f96](https://github.com/imagile-dev/toil/commit/dd66f969f0cdf5a417e586e30d72b90f21d0767d))
* **figma:** add the Figma integration ([#114](https://github.com/imagile-dev/toil/issues/114)) ([c451fc9](https://github.com/imagile-dev/toil/commit/c451fc91117ca36683c37f5d34594d58c4c33dc0))
* foundation with one core behind the CLI and MCP ([#13](https://github.com/imagile-dev/toil/issues/13)) ([7a7a835](https://github.com/imagile-dev/toil/commit/7a7a835b208b42ee0f02b3c357420fa114cb38a7))
* **git:** add the local git integration ([#143](https://github.com/imagile-dev/toil/issues/143)) ([b218e3a](https://github.com/imagile-dev/toil/commit/b218e3ac30d531d6ffc8c30332b8f551ca58c1f1))
* **github:** add the GitHub and GitHub Enterprise Server integration ([#119](https://github.com/imagile-dev/toil/issues/119)) ([e5f05d2](https://github.com/imagile-dev/toil/commit/e5f05d262e0a9287a3dec091efefea32f28a35c4))
* **github:** issues, issue timelines, Projects (v2), bulk get-issue and paging on every list ([#217](https://github.com/imagile-dev/toil/issues/217)) ([85f5e23](https://github.com/imagile-dev/toil/commit/85f5e238760ddfa8c960f621ebe5705cc7921d92))
* **jenkins:** add the Jenkins integration ([#115](https://github.com/imagile-dev/toil/issues/115)) ([712e894](https://github.com/imagile-dev/toil/commit/712e8947be6310ddf04467015f0397dcb56e5e2a))
* **jira-cloud:** add the Jira Cloud integration ([#142](https://github.com/imagile-dev/toil/issues/142)) ([c760354](https://github.com/imagile-dev/toil/commit/c76035480802535409de5eeef00380b4f97eea7f))
* **jira:** Jira Data Center integration ([#66](https://github.com/imagile-dev/toil/issues/66)) ([515c123](https://github.com/imagile-dev/toil/commit/515c12311daef9c31127c6faae28eb724b4ccf23))
* **jira:** move Jira onto the integration kit's context input and paging loop ([#110](https://github.com/imagile-dev/toil/issues/110)) ([81cbf98](https://github.com/imagile-dev/toil/commit/81cbf98b8df1fefda6bdd4d08ed92cbd3c9fe730))
* **jira:** paging, --updated-since, get-changelog and bulk get-issue for jira and jira-cloud ([#220](https://github.com/imagile-dev/toil/issues/220)) ([ca8d936](https://github.com/imagile-dev/toil/commit/ca8d9365f852cfd48cfe64540bd55f202c8e1270))
* KF3 integration-kit fixes and recorded decisions ([#136](https://github.com/imagile-dev/toil/issues/136)) ([7beea71](https://github.com/imagile-dev/toil/commit/7beea71f65f7f4a807a46404766e09a62575db2d))
* **kibana:** add the Kibana integration, paired with Elasticsearch for its API key ([#140](https://github.com/imagile-dev/toil/issues/140)) ([cda3592](https://github.com/imagile-dev/toil/commit/cda3592e5c232e58fa4f25b9f7aefb23b6af909f))
* **logscale:** add the Falcon LogScale integration, built from LogScale's API docs ([#124](https://github.com/imagile-dev/toil/issues/124)) ([ba55c30](https://github.com/imagile-dev/toil/commit/ba55c3018a375eb1a15f041c2253586a6e0cb7f5))
* **openshift:** add the OpenShift / Kubernetes integration ([#132](https://github.com/imagile-dev/toil/issues/132)) ([ed91004](https://github.com/imagile-dev/toil/commit/ed910041f31f4ad7cdcdef086b776c11c15109aa))
* **osv,ossindex:** add OSV.dev and OSS Index as one-source vulnerability commands ([#130](https://github.com/imagile-dev/toil/issues/130)) ([07a8d2f](https://github.com/imagile-dev/toil/commit/07a8d2f85a05e0d95281790817ccd1c0f424e161))
* **saucelabs:** add the Sauce Labs integration ([#127](https://github.com/imagile-dev/toil/issues/127)) ([78f61cb](https://github.com/imagile-dev/toil/commit/78f61cb5ebca061bb40970cb580a93f36b6edf9a))
* **sde:** add the SD Elements integration ([#125](https://github.com/imagile-dev/toil/issues/125)) ([b8dcf03](https://github.com/imagile-dev/toil/commit/b8dcf03f914b7fcf8ef9c3a8194f15d2236fb05e))
* **site:** add the GitHub Pages site ([#3](https://github.com/imagile-dev/toil/issues/3)) ([9b2948d](https://github.com/imagile-dev/toil/commit/9b2948d248af7744a2109bff34078fb5a0202108))
* **site:** How it works, per-integration docs, board deep links ([#19](https://github.com/imagile-dev/toil/issues/19)) ([ab8ce30](https://github.com/imagile-dev/toil/commit/ab8ce3060c70d98eec81df663398b57d7e97bb80))
* **site:** position toil as the token-efficient alternative to MCP ([#237](https://github.com/imagile-dev/toil/issues/237)) ([18cf2ab](https://github.com/imagile-dev/toil/commit/18cf2ab0bc303fe6b1bcc032196e837647feb736))
* **site:** verification levels unit, live and stable, and a README for clones ([#213](https://github.com/imagile-dev/toil/issues/213)) ([bf83942](https://github.com/imagile-dev/toil/commit/bf839421e26dec31d2483eb97f9abee8e79d10ae))
* sixth integration-kit fixes (KF6) ([#149](https://github.com/imagile-dev/toil/issues/149)) ([00c43b7](https://github.com/imagile-dev/toil/commit/00c43b7d42089c8ac122513ae52cf6bea1644e64))
* **skill:** install toil from npm or a clone, register MCP, and install the skill anywhere ([#158](https://github.com/imagile-dev/toil/issues/158)) ([7cd6a75](https://github.com/imagile-dev/toil/commit/7cd6a753ae4f9d7092d7193cc572b453954a5ca2))
* **skills:** add skills marketplace commands for the welcome menu ([#155](https://github.com/imagile-dev/toil/issues/155)) ([a241cb1](https://github.com/imagile-dev/toil/commit/a241cb12867725f60c4fc6581f0e003b1da6ab5a))
* **skill:** the toil skill ships with the CLI, keeps itself current, and is the site's docs ([#205](https://github.com/imagile-dev/toil/issues/205)) ([6dd0adb](https://github.com/imagile-dev/toil/commit/6dd0adbd88fb220665fa20570e04c52c716cb0ce))
* **sonar:** add the SonarQube integration ([#111](https://github.com/imagile-dev/toil/issues/111)) ([c19d7dc](https://github.com/imagile-dev/toil/commit/c19d7dcca33149d9d1bfba9bde76e4ab96fb4801))
* **sonatypeiq:** add the Sonatype IQ Server integration ([#131](https://github.com/imagile-dev/toil/issues/131)) ([e714583](https://github.com/imagile-dev/toil/commit/e71458378b16e005d50c0d716e7b5a76d9966b4f))
* **splitio:** add Split.IO, built from the Admin API reference ([#122](https://github.com/imagile-dev/toil/issues/122)) ([ee0b39b](https://github.com/imagile-dev/toil/commit/ee0b39bf09dea10b3d90fed08ffefaf4a40af0e9))
* **ui:** one dashboard per dossier, fed by a fixture execute() ([#229](https://github.com/imagile-dev/toil/issues/229)) ([01a4e39](https://github.com/imagile-dev/toil/commit/01a4e395450ccfaeaa0ae34cdf740c8679fb10f7))
* **ui:** Toil UI site preview on a fixture Store and a scripted Agent ([#227](https://github.com/imagile-dev/toil/issues/227)) ([b33ab70](https://github.com/imagile-dev/toil/commit/b33ab70600fcca990f3b58966de35c192f29f4f5))
* **util:** add the shared kit the ten local util commands build on ([#187](https://github.com/imagile-dev/toil/issues/187)) ([264c753](https://github.com/imagile-dev/toil/commit/264c753c49985220499fbc79aff48410ed02b494))
* **util:** add util c4, C4 diagrams from a JSON model as SVG, Mermaid or D2 ([#185](https://github.com/imagile-dev/toil/issues/185)) ([4f8cdd5](https://github.com/imagile-dev/toil/commit/4f8cdd5d2732e0e64cbe91dd332a4ef12dce1be3))
* **util:** add util cert to decode certificates and check a chain ([#189](https://github.com/imagile-dev/toil/issues/189)) ([5aa45cc](https://github.com/imagile-dev/toil/commit/5aa45ccfab0bab9f23e0258399d251b32e02df21))
* **util:** add util encode, checked base64, hex and URL encoding and file hashes ([#188](https://github.com/imagile-dev/toil/issues/188)) ([f8d2151](https://github.com/imagile-dev/toil/commit/f8d2151fb2d8661850b12d4151601afb3f399c46))
* **util:** add util jwt decode and util deps scan/diff, local utilities ([#153](https://github.com/imagile-dev/toil/issues/153)) ([dc38592](https://github.com/imagile-dev/toil/commit/dc385925cc0c7eb90a7ee4319383222240719019))
* **util:** add util log, which triages a large log into grouped errors and stack traces ([#190](https://github.com/imagile-dev/toil/issues/190)) ([c23004c](https://github.com/imagile-dev/toil/commit/c23004cf2145e3eebe79d8f1beb10c32e7f7e144))
* **util:** add util md, Markdown to and from Jira wiki, ADF and Confluence storage ([#197](https://github.com/imagile-dev/toil/issues/197)) ([0fc721f](https://github.com/imagile-dev/toil/commit/0fc721f75894a42d3b22fbc0a344b328442de426))
* **util:** add util openapi list, show and example ([#195](https://github.com/imagile-dev/toil/issues/195)) ([3d38e57](https://github.com/imagile-dev/toil/commit/3d38e57db9602de2386bd26a657b2b82b96572f6))
* **util:** add util report for JUnit, TRX, SARIF, lcov and Cobertura ([#191](https://github.com/imagile-dev/toil/issues/191)) ([b87eb8e](https://github.com/imagile-dev/toil/commit/b87eb8e44cc14836ec0546c67ebfa5674d065f7c))
* **util:** add util secrets scan ([#192](https://github.com/imagile-dev/toil/issues/192)) ([5951743](https://github.com/imagile-dev/toil/commit/5951743f582f0a8b775da91703c8460c267a6de1))
* **util:** add util semver to compare, check, sort and bump npm, NuGet and Maven versions ([#193](https://github.com/imagile-dev/toil/issues/193)) ([bc9c8b3](https://github.com/imagile-dev/toil/commit/bc9c8b36e83c0078890a55c652572c99b6dc6c22))
* **util:** add util size, counts, token estimates and outlines for files and folders ([#196](https://github.com/imagile-dev/toil/issues/196)) ([f070666](https://github.com/imagile-dev/toil/commit/f07066679da47e25882255eb12187910590a0e62))
* **util:** add util time: zones, durations, business days and cron run times ([#194](https://github.com/imagile-dev/toil/issues/194)) ([222421d](https://github.com/imagile-dev/toil/commit/222421df9445962ed3c90da4b923bf6ee61d0ed9))
* **util:** Open Work Item spec v0.1, util owi map and mapOwi in ./api ([#224](https://github.com/imagile-dev/toil/issues/224)) ([e7bb7eb](https://github.com/imagile-dev/toil/commit/e7bb7eb9cf4fff69aad6c86ba3f3378288a8fbf1))
* **welcome:** add the Skills and Plugins menu screens ([#166](https://github.com/imagile-dev/toil/issues/166)) ([d234556](https://github.com/imagile-dev/toil/commit/d2345565c500bff00b953e789f992a33f731570f))
* **welcome:** animated splash and main menu for bare toil ([#63](https://github.com/imagile-dev/toil/issues/63)) ([ab66753](https://github.com/imagile-dev/toil/commit/ab66753a91f1d55ea04b98cf204e4ff0f9f9f752))
* **welcome:** brick breaker in the welcome menu ([#163](https://github.com/imagile-dev/toil/issues/163)) ([1104e26](https://github.com/imagile-dev/toil/commit/1104e26122e35e502b8b3f8d87397a2dd3daaac2))
* **welcome:** guided menu over real connections commands, plus connections test, writes and default ([#161](https://github.com/imagile-dev/toil/issues/161)) ([376071d](https://github.com/imagile-dev/toil/commit/376071dad3d6626cc7d1dc599fa5e858ddf9dd9e))
* **welcome:** manage and review dossiers from the menu ([#172](https://github.com/imagile-dev/toil/issues/172)) ([fd834dc](https://github.com/imagile-dev/toil/commit/fd834dc1941aa84ec9c0154c1f74f4b5b44235f7))
* **welcome:** replace brick breaker with Two Weeks' Notice, a hidden roguelike ([#203](https://github.com/imagile-dev/toil/issues/203)) ([dac2b9b](https://github.com/imagile-dev/toil/commit/dac2b9b3d4a82b1ac099bf13714b8e8ee951567a)), closes [#198](https://github.com/imagile-dev/toil/issues/198)


### Bug Fixes

* bootstrap the ID-based OIDC subject and the action group role ([#232](https://github.com/imagile-dev/toil/issues/232)) ([2aaddf5](https://github.com/imagile-dev/toil/commit/2aaddf5db89ae5a578a06dc45d155fc940c457dd))
* **ci:** leave latest alone when the dist-tag lookup fails ([#64](https://github.com/imagile-dev/toil/issues/64)) ([d4a54ed](https://github.com/imagile-dev/toil/commit/d4a54ed1f5bd5b09081a9379b5910e5fa6fa0d39))
* **ci:** open the release PR as the Imagile Bot App; release alphas before 1.0 ([#62](https://github.com/imagile-dev/toil/issues/62)) ([c28aff4](https://github.com/imagile-dev/toil/commit/c28aff4b7e60efadacb9e9606b406ace5f00ad25))
* **core:** say why a connection setting is invalid, not only which one ([#167](https://github.com/imagile-dev/toil/issues/167)) ([f06233d](https://github.com/imagile-dev/toil/commit/f06233d036c9d235a6fec1984d0801e75aac4476))
* **db:** trust the OS certificate store for PostgreSQL TLS ([#159](https://github.com/imagile-dev/toil/issues/159)) ([23b47a6](https://github.com/imagile-dev/toil/commit/23b47a6578a18e9c5cfbbe93afaa058a06818ad2))
* KF4 dot segments after URL normalisation, and group flags on core aliases ([#139](https://github.com/imagile-dev/toil/issues/139)) ([c6ccc38](https://github.com/imagile-dev/toil/commit/c6ccc384abd085fa7d19e55361f5b0f1f7f8955e))
* KF5 refuse a dot segment hidden by ;params ([#141](https://github.com/imagile-dev/toil/issues/141)) ([bbc215b](https://github.com/imagile-dev/toil/commit/bbc215b087fa4a791bc02e2dfd2e8ba278da81b4))
* make main green after KF2 landed with three integrations ([#135](https://github.com/imagile-dev/toil/issues/135)) ([df74cfe](https://github.com/imagile-dev/toil/commit/df74cfeeb0563de06e8b746acc3225204fa0f063))
* **openshift:** pin --env with --instance picking a cluster together after KF3 ([#137](https://github.com/imagile-dev/toil/issues/137)) ([caec866](https://github.com/imagile-dev/toil/commit/caec866a5386e80ad77d13e5fcb21f59b9346381))
* **ship:** a dismissed review never counts as feedback in pr-watch ([#108](https://github.com/imagile-dev/toil/issues/108)) ([8ec9210](https://github.com/imagile-dev/toil/commit/8ec921059214bd2a14597e150ccac1f78d4ae738))
* **test:** allow CHANGELOG.md at the repo root ([#100](https://github.com/imagile-dev/toil/issues/100)) ([877806e](https://github.com/imagile-dev/toil/commit/877806e2bc6185ac3275c74a75e63ee55b7c0c3e))
* **test:** don't fail db tests on a Windows file lock during cleanup ([#112](https://github.com/imagile-dev/toil/issues/112)) ([cad5ea0](https://github.com/imagile-dev/toil/commit/cad5ea0aa5f6fa1d1629411dc9b829455c1bfb4f))
* use placeholders that never resolve for Atlassian and Dynatrace tenants ([#145](https://github.com/imagile-dev/toil/issues/145)) ([659d905](https://github.com/imagile-dev/toil/commit/659d90538b4815b7dee310eab2e31f780463280e))
