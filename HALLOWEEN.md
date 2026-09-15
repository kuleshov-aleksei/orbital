# Halloween 2026 update

## General idea

each user now have personalized customizable pumpkin.
Halloween date is 31st October 2026. Feature should be timegated and not appear until 17.10.26

Main mechanic: simple plant-vs-zombie or steam summer saliens 2018 style mini game where slugs moves towards pumkins in attempt to eat it

All UI controls are for web only (not for mobile) and only for regular rooms (not spatial)

No cooldown between games

# Core functionality

Pumkin appears inside VoiceCallView (above AudioControls). User should be able to enter a mini game by clicking on it

## Farming pumkin decorations by playing a mini game

### mini game flow

Upon clicking current user's pumpkin a popup appears with:
- a "Defend pumkin" button. If pressed, popup changes to a mini game
- customization tab (here users can apply earned prizes)
- leaderboard tab that shows highest score

Pumkins spawn on the left side of the screen and does not move
Slugs spawns on the right side of the screen and crawls towards pumkins (to the left)

Player have inventory with 6 slots (more about it later). If new item added when there are no empty slots - oldest item is removed. Inventory is ephimeral and resets every game

If user closes tab/leaves the call, game ends, but client should send achieved score with report to the backend (with incomplete game flag)

When all cards choosen, next round starts immidiatelly

#### Pumkins mechanics

Pumkins have health. If health drops to 0 - pumkin is destroyed
If all pumkins die - game ends

There should be 4 types of pumpkins:
- Ferdinand - regular pumkin, shoots with pumkin seeds
- Chunky - tank pumkin, have high health pool, but do not shoot
- Herbert - healer pumkin, shoots with glowing seeds at other pumpkins and health them
- Gwynevere - artillery, shoots with homing missles that does aoe damage (automatically picks shooting point with the most impact)

Pumkins shoot automatically:
- Ferdinand picks closest target and shoots at the slug. It should predict slug trajectory and seed speed
- Herber picks target with lowest amount of health
- Gwynevere - have area of damage, so it picks a point (with prediction to slug velocity) between slugs in such a way, that the most impact could be made (e.g. it favors points that will affect 3 slugs instead of 2 slugs)

User can override automatic targeting and point to any place on the playble area

#### Pumkin balance table

| Pumkin | Fire rate/s | Health | Damage per shot | Projectile speed |
|-|-|-|-|-|
| Ferdinand | 1/s | 10 | 5 | 100 units/s |
| Chunky | 0/s | 50 | 0 | 0 units/s |
| Herbert | 0.5/s | 10 | 5 | 150 units/s |
| Gwynevere | 1 shot every 10 seconds | 5 | 10 | 40 units/s (elliptic curve) |

#### Slugs mechanic

There is 4 types of slugs:

- Scout - fast slug
- Marvin - regular slug
- Gerald - big, chonky slug
- Dr. Dell Conagher - engineer slug that does not moves, but spawns Marvins every 5 seconds

When slug reaches a pumkin, it deals damage every 3 seconds until slug or pumkin dies. If slug survives, it continues to move towards the next pumkin

#### Slug balance table

| Slug | Speed | Health | Damage to pumkin | Reward points |
|-|-|-|-|-|
| Scout | 50 units/s | 10 | 2 | 10 |
| Marvin | 50 units/s | 20 | 5 | 20 |
| Gerald | 30 units/s | 100 | 20 | 50 |
| Dr. Dell Conagher | 0 units/s | 10 | 0 | 100 |

Reward per slug also depends on position. Battlefield - 1000 units
- 700+ units - 100% reward
- 500+ units - 70% reward
- 300+ units - 50% reward
- 0-299 units - 35% reward

Every slug moves with slightly different speed (e.g. slug A moves 1% slower than slug B). More in the balance table

#### Player abilities

Player can earn some abilities (more about earning later)

All abilities are single use items

- Distraction - all slugs move in an opposite direction (except Dr. Dell Conagher - he does not move at all)
- Annihilation - instantly kill slug with the most health
- Freeze - all slugs stops moving for 5 seconds
- "Do not stop, daddy" - Permanently increase shooting speed of a single selected pumkin
- "Wide pumpkin" - Permanently inreases health pool x2 of a single selected pumpkin
- "Holy grenade" - player choses a spot to spawn a grenade that will detonate in 3 seconds after landing. It deals damage only to slugs in 300 units radius
- "Beer" - a cup, placed in the battlefield that attracts slugs. Slug take 1 hit point of damage and resume their crawl towards pumkins. Only slugs that are behind a cup notice it. Slugs that already passed the cup just move as always. Cup duration is 30 seconds
- "Genocide" - a salt bottle that creates a vertical line of salt. Any slug that steps on the salt takes 1 hit per 5 seconds of damage. Salt duration is 30 seconds

#### Ability balance table

| Title | Damage | Score |
|-|-|
| Annihilation | Full health | 70% of regular reward for killing current slug type | 
| Holy grenade | 50 | 80% of regular reward for killing current slug type | 
| Beer | 1 | 500 |
| Genocide | 1 per 5 second | 10 |

Slug position do not impact score for killing slugs using abilities. Score is rewarded only for killing the slug, not for using the item.

Beer kill is so rare that it worth so much points

#### Game loop

Game is round based. Each round predetermined pool of slug spawns. Deeper the game - more slugs.
Round end condition: all slugs destroyed - round win. All pumkins destroyed - game over
After each round a popup appears. Popup contains a choice of 3 random cards:
- 1 Pumking card - item that spawns a pumkin in a selected place
- 1 Ability card - item that uses an ability from list above
- 1 random card - pumkin OR ability
Card is selected randomly from available ability + pumkin pool (all described above) and shown to a player

1 round - 1 popup
2 round - 2 popups
3 round - 3 popups
Capped at 3 popups, endless rounds

Popup can be skipped - player wont receive a reward. Popups are sequential

Player can exit the game between rounds - a button should just stop it and give a reward

#### Slug per round balance table

Round 1:

time between spawns: 7 seconds

| Slug type | Amount | Speed variation |
| Scout | 10 | 1% |
| Marvin | 2 | 1% |

Round 2:

time between spawns: 7 seconds

| Slug type | Amount | Speed variation |
| Scout | 16 | 2% |
| Marvin | 8 | 2% |
| Gerald | 1 | 1% |

Round 3:

time between spawns: 5 seconds

| Slug type | Amount | Speed variation |
| Scout | 16 | 4% |
| Marvin | 8 | 4% |
| Dr. Dell Conagher | 1 | 0% |

Round 4:

time between spawns: 4 seconds

| Slug type | Amount | Speed variation |
| Scout | 24 | 4% |
| Marvin | 8 | 4% |
| Gerald | 3 | 6% |
| Dr. Dell Conagher | 2 | 0% |

rounds 5+:

time between spawns: 4 seconds

| Slug type | Amount | Speed variation |
| Scout | round number * 5 | 4% |
| Marvin | round number * 1.5 | 4% |
| Gerald | sqrt(round number) | 4% |
| Dr. Dell Conagher | sqrt(round number) | 0% |

slug cound rounds via ceil().

Slugs spawns in random order every N seconds

#### Starting conditions

Player starts with 2 Ferdinands in inventory and they can place them just as regular pumkins

##### Score

For each slug player earns points. Each rounds earn player a points (server defined)

completed round += current round number * 1000

At the end of the game (after winning, losing, or ending) player is given a reward. Player can receive multiple rewards per game (awards based on score, amount based on completed rounds):

| Completed round | Number of rewards |
|-|-|
| 1 | 1 |
| 2 | 1 |
| 3 | 1 |
| 4 | 2 |
| 5 | 2 |
| 6 | 2 |
| 7 | 3 |
| 8 | 3 |
| 9 | 3 |
| 10 | 4 |

Cap - 4 rewards

If user receive more than 1 reward, he receive them in the following algorithm:
- 1 top tier reward
- 1 lower tier
- 1 even lower

e.g: if user reaches 9617 points on level 7 he is rewarded with:
1 Rare item, 1 uncommon item, 1 common item

If user reaches 6712 points on level 5 he is rewarded with:
1 uncommon item, 1 common item

There are 4 pools of rewards:
0 - 999 - no reward
1000 - 1999 - regular item
2000 - 4999 - common item
5000 - 7999 - uncommon item
8000+ - rare item

All items are pumpkin decorations, like different hats, different eyes, different smiles, etc.
Hats
- Party hat (rare)
- Frog hat (rare)
- Beret (regular)

Eyes:
- Sinister (rare)
- Scared (common)
- Smiling (uncommon)
- Cat eyes (uncommon)

Smiles:
- Vampire (rare)
- Crooked (uncommon)
- Pumkin (common)

etc, pool will be increased.

rewards are stored in the backend in the database. Client sends backend information about the game:
- Spawned pumkins (type and count)
- List of killed slugs with type and position (and information how they have been killed - by pumkin or ability (which one?))
- List and count of used items (abilities)
- Number of completed rounds
- Score

Backend stores score values for each slug type and value for each round. Backend also is source of truth about proximity based scoring (thresholds).
When user loads a game, it should fetch info from the server.

Score should be visible to player and update in real time (we can calculate it on the client side, validation is required only when rounds are submitted)

Game info stored in the database in json

Backend should validate win condition: it takes amount of killed slugs and completed wave number and calculates the score. Score should be the same as on the frontend +- rounding error of about 10% (backend calculated == report.score with error). If equal - ok, if mismatch - report an error - cheater is found. But also, save round in the database with "cheater" flag. So we can resolve any issues later. Do not give reward in that case

Backend generates a reward and stores received item in the databae (reward should not duplicate per-user pool). If no items left to give, just message that all rewards have been earned. Also, backend should store a leaderboard which every user can see

## Decorations

User can customize his pumkin with earned decorations. This customization is saved in the backend and propogated to all clients in the call

For other participant: they can see pumkins of other users (with his own) at the bottom of the VoiceCallView. Decorations of other users applied to them. A username is shown above the pumkin

How customization works: when selected, some sort of mask is applied to the specific socket - hat, eyes, etc. Multiple sockets can have customization: e.g. hat A + eyes B

Pumkins strip lays above AudioControls 

## Implementation

We already have pixi js integrated into our app. And there is some stuff to render 2d tiles, animations, calculate collisions, etc. It can be used as a starting point

## Assets

Currently, there are not assets - no sfx, no background images, no pumkins or slugs. Use some placeholders, like solid color, rectangles, etc

Pretty much all events should have sound effects such as:
- pumkin destruction
- slug destruction
- items usage
- slug movement
- shooting
- etc

Maintain a list of events e.g. we use sounds.ts. Sound sprite will be created later

## Other points:

Event should be avaiable after the halloween, no timegate here

Admin panel should have a tab in which he can look at game history and issue a specific reward to any player

Guests can participate, but they lose earned pumkin decorations when deleted. Game info table should still contain entry, but with specific <DELETED> user placeholder. We can use some placeholder value for that

The game continues even if focus was lost. Nothing can stop slug expansion!

# Implementation draft

Migration 20 — create_halloween_tables (order: items → game_results → rewards → pumpkins so FKs resolve):
CREATE TABLE IF NOT EXISTS halloween_items (
  id         TEXT PRIMARY KEY,          -- 'hat_party', 'eyes_sinister', ...
  name       TEXT NOT NULL,
  socket     TEXT NOT NULL,             -- hat | eyes | smile | base
  rarity     TEXT NOT NULL,             -- regular | common | uncommon | rare
  sort_order INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_halloween_items_rarity ON halloween_items(rarity);

CREATE TABLE IF NOT EXISTS halloween_game_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL,       -- '<DELETED>' placeholder after guest purge; NO users FK
  completed_rounds INTEGER NOT NULL,
  score            INTEGER NOT NULL,
  is_incomplete    BOOLEAN NOT NULL DEFAULT 0,  -- tab close / left call
  is_cheater       BOOLEAN NOT NULL DEFAULT 0,
  report_json      TEXT NOT NULL,       -- spawned pumpkins, kills(type+pos+source), used items
  reward_json      TEXT,                -- ['hat_party','eyes_sinister',...] for admin view
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_halloween_game_results_user  ON halloween_game_results(user_id);
CREATE INDEX IF NOT EXISTS idx_halloween_game_results_score ON halloween_game_results(score);

CREATE TABLE IF NOT EXISTS halloween_rewards (        -- owned decorations = ledger; no users FK
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'game',            -- game | admin
  game_id    INTEGER,
  granted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, item_id),                          -- per-user no-duplicate pool
  FOREIGN KEY (item_id) REFERENCES halloween_items(id),
  FOREIGN KEY (game_id) REFERENCES halloween_game_results(id)
);
CREATE INDEX IF NOT EXISTS idx_halloween_rewards_user ON halloween_rewards(user_id);

CREATE TABLE IF NOT EXISTS halloween_pumpkins (       -- one per user, customization state
  user_id      TEXT PRIMARY KEY,
  equipped_json TEXT NOT NULL DEFAULT '{}',           -- {"hat":"hat_party","eyes":"eyes_sinister"}
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
Migration 21 — seed_halloween_items: inserts the 10 catalog rows (party/frog/beret hats, sinister/scared/smiling/cat eyes, vampire/crooked/pumpkin smiles) with rarities per the doc.
Guest purge hook: halloween_game_results/halloween_rewards have no users FK on purpose. In AdminHandler.DeleteUser and DeleteAllGuests (adminhandler.go:316, 336): UPDATE halloween_game_results SET user_id='<DELETED>' WHERE user_id=? and DELETE FROM halloween_rewards + halloween_pumpkins for that user (cascade handles pumpkins on users delete).
Backend logic
Score validation (halloweenservice.go) — recompute from report:
- pumpkin kill → slug_points[type] × proximity(x) (proximity: x≥700→1.0, ≥500→0.7, ≥300→0.5, else 0.35)
- annihilation → round(points × 0.7), holy_grenade → round(points × 0.8), beer → 500, genocide → 10 (position ignored for abilities)
- round bonus → Σ 1000·n for n=1..completed_rounds
- pass if |report.score − computed| ≤ 0.1 × computed; else is_cheater=1, no reward.
Reward grant:
- tier = score bracket (regular/common/uncommon/rare; none if <1000); count = tablecompleted_rounds (1,1,1,2,2,2,3,3,3,4)
- for i in 0..count−1: pick random unowned item from catalog where rarity = tier−i (rare→uncommon→common→regular); stop when tiers exhausted or pool empty (return "all rewards earned"). Insert into halloween_rewards.
- Leaderboard = query over game_results (MAX(score) GROUP BY user_id, excluding cheaters), no table needed.
API + WS surface
- GET /api/halloween/state — pumpkin equipped + owned items + catalog (for customization tab)
- PUT /api/halloween/pumpkin — save equipped JSON
- GET /api/halloween/game/config — server-authoritative score tables (per-slug points, round bonus, proximity thresholds, ability scores, reward brackets) — fetched at game load
- POST /api/halloween/game/report — submit; returns granted items
- GET /api/halloween/leaderboard
- Admin: GET /api/admin/halloween/games, POST /api/admin/halloween/rewards (issue item)
- New WS message type halloween_pumpkin_state (user_id + equipped) — broadcast to room on change; on room join each client fetches via REST. Extends the closed enums in frontend/src/types/index.ts and hub.go.
Frontend
- frontend/src/halloween/ — balance config (mirrors backend config payload), slug/pumpkin entity logic, projectile/ability systems, round definitions, score calc
- PumpkinStrip component (above AudioControls in VoiceCallView), Pixi pumpkin renderer with sockets, PumpkinModal (Defend/customization/leaderboard tabs), MiniGame (Pixi canvas, existing world/ as starting point)
- New SoundEvents appended to SoundEvent in frontend/src/types/audio.ts + sounds.ts (pumpkin_destroyed, slug_destroyed, item_used, shooting, slug_movement)
