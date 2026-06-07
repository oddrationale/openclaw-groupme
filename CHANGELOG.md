# Changelog

## [0.5.0](https://github.com/oddrationale/openclaw-groupme/compare/openclaw-groupme-v0.4.4...openclaw-groupme-v0.5.0) (2026-06-07)


### ⚠ BREAKING CHANGES

* Requires OpenClaw v2026.6.1 and uses the updated plugin

### Features

* modernize GroupMe channel for OpenClaw 2026.6.1 ([#60](https://github.com/oddrationale/openclaw-groupme/issues/60)) ([241bc6d](https://github.com/oddrationale/openclaw-groupme/commit/241bc6dbd552d920629081bf60ea4999092e27ad))

## [0.4.4](https://github.com/oddrationale/openclaw-groupme/compare/openclaw-groupme-v0.4.3...openclaw-groupme-v0.4.4) (2026-06-05)


### Bug Fixes

* authenticate ClawHub publish in CI ([#50](https://github.com/oddrationale/openclaw-groupme/issues/50)) ([0355837](https://github.com/oddrationale/openclaw-groupme/commit/0355837c7a40299d86c5f8044075652094586a09))

## [0.4.3](https://github.com/oddrationale/openclaw-groupme/compare/openclaw-groupme-v0.4.2...openclaw-groupme-v0.4.3) (2026-06-05)


### Bug Fixes

* include compiled plugin output for ClawHub ([#48](https://github.com/oddrationale/openclaw-groupme/issues/48)) ([fb3a793](https://github.com/oddrationale/openclaw-groupme/commit/fb3a79378ee084cf02e47c17e27fa6597db3ebdf))

## [0.4.2](https://github.com/oddrationale/openclaw-groupme/compare/openclaw-groupme-v0.4.1...openclaw-groupme-v0.4.2) (2026-06-05)


### Bug Fixes

* publish ClawHub package from npm artifact ([#46](https://github.com/oddrationale/openclaw-groupme/issues/46)) ([d4a6bdd](https://github.com/oddrationale/openclaw-groupme/commit/d4a6bdd1acd6215b75166e0036f68f251936e556))

## [0.4.1](https://github.com/oddrationale/openclaw-groupme/compare/openclaw-groupme-v0.4.0...openclaw-groupme-v0.4.1) (2026-06-05)


### Bug Fixes

* add ClawHub package publishing ([#42](https://github.com/oddrationale/openclaw-groupme/issues/42)) ([7d3f297](https://github.com/oddrationale/openclaw-groupme/commit/7d3f29711adb4aeff996f3cc952aa827d0735185))

## [0.4.0](https://github.com/oddrationale/openclaw-groupme/compare/openclaw-groupme-v0.3.0...openclaw-groupme-v0.4.0) (2026-02-28)


### ⚠ BREAKING CHANGES

* Minimum openclaw peer dependency raised to >=2026.2.26.

### Features

* adopt OpenClaw v2026.2.26 SDK features ([#39](https://github.com/oddrationale/openclaw-groupme/issues/39)) ([16a47d9](https://github.com/oddrationale/openclaw-groupme/commit/16a47d949a0b59b3e61b2fa6964418c7a028b728))
* streamlined GroupMe onboarding and config simplification ([#16](https://github.com/oddrationale/openclaw-groupme/issues/16)) ([1f42816](https://github.com/oddrationale/openclaw-groupme/commit/1f4281635d3c8cf707dfa9d3ed7c28197769765b))


### Bug Fixes

* always enforce group binding check and rename expectedGroupId to groupId ([#30](https://github.com/oddrationale/openclaw-groupme/issues/30)) ([384ec47](https://github.com/oddrationale/openclaw-groupme/commit/384ec47b8fbd99b248ae89c461d7591bc2f805b5))
* change plugin id from 'groupme' to 'openclaw-groupme' ([#25](https://github.com/oddrationale/openclaw-groupme/issues/25)) ([99bf57a](https://github.com/oddrationale/openclaw-groupme/commit/99bf57adb329ec3ce7c78a03830b6bf7f830c739)), closes [#24](https://github.com/oddrationale/openclaw-groupme/issues/24)
* eliminate timing side-channel in token comparison and warn on missing groupId ([721a20a](https://github.com/oddrationale/openclaw-groupme/commit/721a20afd6fd199c3a0f4d40d0b62e9518d8cb0c))
* improve GroupMe onboarding bot registration reliability ([#18](https://github.com/oddrationale/openclaw-groupme/issues/18)) ([87ea4af](https://github.com/oddrationale/openclaw-groupme/commit/87ea4af269a5b4551179fa0f9f971872897f7257))
* revert plugin id to 'groupme' for consistency across configurations ([f73191c](https://github.com/oddrationale/openclaw-groupme/commit/f73191c5757958e21af1b5352792fb1fd065baee))
* revert plugin id to 'groupme' to align with openclaw doctor ([#27](https://github.com/oddrationale/openclaw-groupme/issues/27)) ([dca6755](https://github.com/oddrationale/openclaw-groupme/commit/dca67552a2fc9fc58231e9b7b24a7c1d191fc062))

## [0.3.0](https://github.com/oddrationale/openclaw-groupme/compare/v0.2.0...v0.3.0) (2026-02-18)


### Features

* streamlined GroupMe onboarding and config simplification ([#16](https://github.com/oddrationale/openclaw-groupme/issues/16)) ([1f42816](https://github.com/oddrationale/openclaw-groupme/commit/1f4281635d3c8cf707dfa9d3ed7c28197769765b))


### Bug Fixes

* always enforce group binding check and rename expectedGroupId to groupId ([#30](https://github.com/oddrationale/openclaw-groupme/issues/30)) ([384ec47](https://github.com/oddrationale/openclaw-groupme/commit/384ec47b8fbd99b248ae89c461d7591bc2f805b5))
* change plugin id from 'groupme' to 'openclaw-groupme' ([#25](https://github.com/oddrationale/openclaw-groupme/issues/25)) ([99bf57a](https://github.com/oddrationale/openclaw-groupme/commit/99bf57adb329ec3ce7c78a03830b6bf7f830c739)), closes [#24](https://github.com/oddrationale/openclaw-groupme/issues/24)
* improve GroupMe onboarding bot registration reliability ([#18](https://github.com/oddrationale/openclaw-groupme/issues/18)) ([87ea4af](https://github.com/oddrationale/openclaw-groupme/commit/87ea4af269a5b4551179fa0f9f971872897f7257))
* revert plugin id to 'groupme' for consistency across configurations ([f73191c](https://github.com/oddrationale/openclaw-groupme/commit/f73191c5757958e21af1b5352792fb1fd065baee))
* revert plugin id to 'groupme' to align with openclaw doctor ([#27](https://github.com/oddrationale/openclaw-groupme/issues/27)) ([dca6755](https://github.com/oddrationale/openclaw-groupme/commit/dca67552a2fc9fc58231e9b7b24a7c1d191fc062))

## [0.2.0](https://github.com/oddrationale/openclaw-groupme/compare/v0.1.0...v0.2.0) (2026-02-17)


### Features

* streamlined GroupMe onboarding and config simplification ([#16](https://github.com/oddrationale/openclaw-groupme/issues/16)) ([1f42816](https://github.com/oddrationale/openclaw-groupme/commit/1f4281635d3c8cf707dfa9d3ed7c28197769765b))


### Bug Fixes

* always enforce group binding check and rename expectedGroupId to groupId ([#30](https://github.com/oddrationale/openclaw-groupme/issues/30)) ([384ec47](https://github.com/oddrationale/openclaw-groupme/commit/384ec47b8fbd99b248ae89c461d7591bc2f805b5))
* change plugin id from 'groupme' to 'openclaw-groupme' ([#25](https://github.com/oddrationale/openclaw-groupme/issues/25)) ([99bf57a](https://github.com/oddrationale/openclaw-groupme/commit/99bf57adb329ec3ce7c78a03830b6bf7f830c739)), closes [#24](https://github.com/oddrationale/openclaw-groupme/issues/24)
* improve GroupMe onboarding bot registration reliability ([#18](https://github.com/oddrationale/openclaw-groupme/issues/18)) ([87ea4af](https://github.com/oddrationale/openclaw-groupme/commit/87ea4af269a5b4551179fa0f9f971872897f7257))
* revert plugin id to 'groupme' for consistency across configurations ([f73191c](https://github.com/oddrationale/openclaw-groupme/commit/f73191c5757958e21af1b5352792fb1fd065baee))
* revert plugin id to 'groupme' to align with openclaw doctor ([#27](https://github.com/oddrationale/openclaw-groupme/issues/27)) ([dca6755](https://github.com/oddrationale/openclaw-groupme/commit/dca67552a2fc9fc58231e9b7b24a7c1d191fc062))

## [0.1.0](https://github.com/oddrationale/openclaw-groupme/compare/v0.0.4...v0.1.0) (2026-02-17)


### Features

* streamlined GroupMe onboarding and config simplification ([#16](https://github.com/oddrationale/openclaw-groupme/issues/16)) ([1f42816](https://github.com/oddrationale/openclaw-groupme/commit/1f4281635d3c8cf707dfa9d3ed7c28197769765b))


### Bug Fixes

* always enforce group binding check and rename expectedGroupId to groupId ([#30](https://github.com/oddrationale/openclaw-groupme/issues/30)) ([384ec47](https://github.com/oddrationale/openclaw-groupme/commit/384ec47b8fbd99b248ae89c461d7591bc2f805b5))
* change plugin id from 'groupme' to 'openclaw-groupme' ([#25](https://github.com/oddrationale/openclaw-groupme/issues/25)) ([99bf57a](https://github.com/oddrationale/openclaw-groupme/commit/99bf57adb329ec3ce7c78a03830b6bf7f830c739)), closes [#24](https://github.com/oddrationale/openclaw-groupme/issues/24)
* improve GroupMe onboarding bot registration reliability ([#18](https://github.com/oddrationale/openclaw-groupme/issues/18)) ([87ea4af](https://github.com/oddrationale/openclaw-groupme/commit/87ea4af269a5b4551179fa0f9f971872897f7257))
* revert plugin id to 'groupme' for consistency across configurations ([f73191c](https://github.com/oddrationale/openclaw-groupme/commit/f73191c5757958e21af1b5352792fb1fd065baee))
* revert plugin id to 'groupme' to align with openclaw doctor ([#27](https://github.com/oddrationale/openclaw-groupme/issues/27)) ([dca6755](https://github.com/oddrationale/openclaw-groupme/commit/dca67552a2fc9fc58231e9b7b24a7c1d191fc062))
