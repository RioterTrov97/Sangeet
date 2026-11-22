# App Store listing (deliver layout)

Edit the text files, then run `scripts/testflight.sh metadata` (see docs/INSTALL.md). Nothing here submits the app for review.

| File | Limit |
| --- | --- |
| `en-AU/name.txt` | 30 characters |
| `en-AU/subtitle.txt` | 30 |
| `en-AU/promotional_text.txt` | 170 |
| `en-AU/description.txt` | 4000 |
| `en-AU/keywords.txt` | 100, comma separated, no spaces needed |
| `en-AU/release_notes.txt` | 4000 (What's New) |
| `en-AU/beta_description.txt` | 4000 (TestFlight, sent by the `beta` lane) |
| `copyright.txt` | free text |
| `primary_category.txt`, `secondary_category.txt` | App Store category ids (MUSIC, ENTERTAINMENT) |
| `app_rating_config.json` | age rating answers (App Store Connect API names) |

Not stored here, supplied from ENV by the Fastfile: privacy URL (`PRIVACY_URL`), support URL (`SUPPORT_URL`), and the review contact (`REVIEW_FIRST_NAME`, `REVIEW_LAST_NAME`, `REVIEW_EMAIL`, `REVIEW_PHONE`, only for `submit_review`).
The App Privacy answers (nutrition label) cannot be set by fastlane: see `docs/privacy-policy.md`.
Avoid third-party trademarks in the name, subtitle and keywords.
