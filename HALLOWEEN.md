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

Player have coins for which he can purchase more pumkins. He earns coins for every kill. Coins are shown as pumkin seeds near shop

There is a shop with every purchasable type of pumkin (PEARcer is card-exclusive and never appears there). Shop should be displayed side-by-side near inventory. Player can spend seeds (coins) in order to purchase a pumkin. Purchased pumkins placed directly into his inventory. Shop prices inflate per purchase: floor(base * 1.15^n), capped at 5x base — only shop buys count, free card pumpkins don't inflate prices.

Player can sell pumpkins for 50% of their cost

#### Pumkins mechanics

Pumkins have health. If health drops to 0 - pumkin is destroyed
If all pumkins die - game ends

There should be 6 types of pumpkins:
- Ferdinand - regular pumkin, shoots with pumkin seeds
- Chunky - tank pumkin, have high health pool, but do not shoot
- Herbert - healer pumkin, shoots with glowing seeds at other pumpkins and health them
- Gwynevere - artillery, shoots with homing missles that does aoe damage (automatically picks shooting point with the most impact)
- Cramer - pumkin that produces seeds (coins that player can use). Do not shoot
- PEARcer - card-exclusive pear-skinned sniper (never in the shop), slow heavy piercing seeds

Pumkins shoot automatically:
- Ferdinand picks closest target and shoots at the slug. It should predict slug trajectory and seed speed
- Herber picks target with lowest amount of health
- Gwynevere - have area of damage, so it picks a point (with prediction to slug velocity) between slugs in such a way, that the most impact could be made (e.g. it favors points that will affect 3 slugs instead of 2 slugs)

User can override automatic targeting and point to any place on the playble area

#### Pumkin balance table

| Pumkin | Fire rate/s | Health | Damage per shot | Projectile speed | Special notes | Cost in the shop |
|-|-|-|-|-|-|
| Ferdinand | 1/s | 10 | 5 | 100 units/s |-| 20 |
| Chunky | 0/s | 50 | 0 | 0 units/s |-| 40 |
| Herbert | 0.5/s | 10 | 5 | 150 units/s |-| 40 |
| Gwynevere | 1 shot every 10 seconds | 5 | 10 | 40 units/s (elliptic curve) |-| 70 |
| Cramer | 0/s | 10 | 0 | 0 | Produces 1 coin every 5 seconds (diminishing: nth alive Cramer works at 1/2^(n-1) rate) | 75 |
| PEARcer | 1 shot every 4 seconds | 5 | 25 | 200 units/s | Card-exclusive pear-skinned sniper, never sold in the shop. Seeds pierce through up to 8 slugs in his lane, hitting each once | not for sale (sells for 50) |

### Pumkin level up mechanic

Player earn xp per killed slug, each slug have its own reward (see slugs balancing charts below).
Player can spend xp to level up pumkins. XP pool is global

Pumkins can be leveled up. Pumkins have 3 levels. Level increases stats like HP, fire rate, damage, heal amount, money per second amount. Each pumkin have its own balance table

Design rule: level 2 is ~+35-40% effective power over level 1, level 3 is ~+70-85% over level 1. A level 2 pumkin is never as powerful as 2 pumkins at level 1 (200%). Leveling up is worth it because it saves board space (30 cells). Level-up adds `newMax - oldMax` HP on top of current health (damage taken is kept, no free full heal). Dell-spawned Marvins grant the same XP as regular Marvins

Level-up is done via a "Level up" button in the pumkin hover tooltip (next to Sell), available during the playing phase only. Selling a pumkin refunds 50% of its base coin cost and does not refund spent XP

Cost per level:
| Starting level | Next level xp cost |
|-|-|
| 1 | 40 |
| 2 | 80 |

Full level-up to 3 costs 120 XP. Total XP earnable from round 1 to round 7 is ~996 (plus Dell-spawned Marvins, ~1100 total), so a player can level about 7-10 pumkins to level 3 by wave 7 at most. Dell-spawned Marvins are capped at 20 per Dell, so even a deliberately kept-alive Dell yields at most 60 XP

#### Pumkin level balance table

| Pumkin | Level | Health | Fire rate | Damage / heal per shot | Projectile speed | Coins | Notes |
|-|-|-|-|-|-|-|-|
| Ferdinand | 1 | 10 | 1/s | 5 | 100 units/s | - | ~5 DPS |
| Ferdinand | 2 | 14 | 1.15/s | 6 | 100 units/s | - | ~6.9 DPS (+38%) |
| Ferdinand | 3 | 18 | 1.3/s | 7 | 100 units/s | - | ~9.1 DPS (+82%) |
| Chunky | 1 | 50 | 0/s | 0 | 0 | - | tank, does not shoot |
| Chunky | 2 | 75 | 0/s | 0 | 0 | - | 1.5x, less than 2x level 1 (100) |
| Chunky | 3 | 100 | 0/s | 0 | 0 | - | 2x level 1, still costs 120 XP + a slot |
| Herbert | 1 | 10 | 0.5/s | 5 heal | 150 units/s | - | ~2.5 HPS |
| Herbert | 2 | 14 | 0.6/s | 5 heal | 150 units/s | - | ~3.0 HPS (+20%, heal flat — nerfed) |
| Herbert | 3 | 18 | 0.7/s | 5 heal | 150 units/s | - | ~3.5 HPS (+40%, heal flat — nerfed) |
| Gwynevere | 1 | 5 | 1 shot every 10 seconds | 10 | 40 units/s (elliptic curve) | - | blast radius 70 |
| Gwynevere | 2 | 7 | ~1 shot every 8.7 seconds | 13 | 40 units/s (elliptic curve) | - | blast radius 80 |
| Gwynevere | 3 | 9 | ~1 shot every 7.7 seconds | 16 | 40 units/s (elliptic curve) | - | blast radius 90 |
| Cramer | 1 | 10 | 0/s | 0 | 0 | 1 coin every 5 seconds | diminishing: nth alive Cramer works at 1/2^(n-1) rate |
| Cramer | 2 | 14 | 0/s | 0 | 0 | 1 coin every 4 seconds (+25%) | diminishing unchanged |
| Cramer | 3 | 18 | 0/s | 0 | 0 | 1 coin every 3 seconds (+67%, less than 2x) | diminishing unchanged |
| PEARcer | 1 | 5 | 1 shot every 4 seconds | 25 | 200 units/s | - | card-exclusive, pierces up to 8 slugs |
| PEARcer | 2 | 7 | ~1 shot every 3.6 seconds | 30 | 200 units/s | - | pierce stays 8 |
| PEARcer | 3 | 9 | ~1 shot every 3.1 seconds | 35 | 200 units/s | - | ~11.2 DPS (+79%), pierce stays 8 |


#### Slugs mechanic

There is 4 types of slugs:

- Scout - fast slug
- Marvin - regular slug
- Gerald - big, chonky slug
- Dr. Dell Conagher - engineer slug that does not moves, but spawns Marvins every 5 seconds, maximum 20 Marvins per Dell (cap against XP/coin farming)

When slug reaches a pumkin, it deals damage every 3 seconds until slug or pumkin dies. If slug survives, it continues to move towards the next pumkin

#### Slug balance table

| Slug | Speed | Health | Damage to pumkin | Reward points | Kill reward (coins/seeds) | XP reward |
|-|-|-|-|-|-|-|
| Scout | 50 units/s | 10 | 2 | 10 | 2 | 2 |
| Marvin | 50 units/s | 20 | 5 | 20 | 5 | 3 |
| Gerald | 30 units/s | 100 | 20 | 50 | 15 | 3 |
| Dr. Dell Conagher | 0 units/s | 10 | 0 | 100 | 25 | 5 |

Reward per slug also depends on position. Battlefield - 1000 units
- 700+ units - 100% reward
- 500+ units - 70% reward
- 300+ units - 50% reward
- 0-299 units - 35% reward

Slug max HP compounds every round: HP *= 1.27^(round-1). Round 1 is exactly at base values; a round 6 scout has ~18 HP, a round 10 Gerald ~280+. Dell-spawned Marvins inherit the current round multiplier.

#### Shielded slugs (elites)

From round 2 on, a configured number of slugs per round arrives shielded (round 1: none). Each shielded slug rolls 3-6 shields. One hit strips exactly one shield and deals no HP damage, regardless of how much damage the shot deals. Slows (beer puddle, salt), freeze, distraction and Herbert heals ignore shields. Annihilation bypasses shields entirely. Shielded slugs render with a cyan ring plus one tick per remaining shield, and the round prompt calls out how many are incoming.

Every slug moves with slightly different speed (e.g. slug A moves 1% slower than slug B). More in the balance table

#### Player abilities

Player can earn some abilities (more about earning later)

All abilities are single use items

- Distraction - all slugs move in an opposite direction (except Dr. Dell Conagher - he does not move at all)
- Annihilation - instantly kill slug with the most health
- Freeze - all slugs stops moving for 8 seconds
- "Do not stop, daddy" - Permanently increase shooting speed of a single selected pumkin
- "Wide pumpkin" - Permanently inreases health pool x2 of a single selected pumpkin
- "Holy grenade" - player choses a spot to spawn a grenade that will detonate in 3 seconds after landing. It deals damage only to slugs in 300 units radius
- "Beer puddle" - a sticky puddle, placed in the battlefield, that drags slugs toward the cup and slows them by 40% while they wade through it. If a slug reaches the center of the puddle, it gets stuck for 2 seconds (once per slug). Puddle duration is 30 seconds
- "Salt line" - a salt bottle that creates a vertical line of salt. Any slug that steps on this line slows down by 30%. Line width is 120 units Salt duration is 30 seconds
- "Tailwind" - all pumpkins shoot 50% faster for 10 seconds
- "Seed rain" - instantly gain 100 coins
- "Thorn patch" - a patch of thorns, placed in the battlefield, that damages slugs crossing it (8 damage per second across all lanes at that x). Patch width is 120 units, duration is 20 seconds

#### Ability balance table

| Title | Damage | Score |
|-|-|
| Annihilation | Full health | 70% of regular reward for killing current slug type | 
| Holy grenade | 50 | 80% of regular reward for killing current slug type | 
| Beer puddle | 0 | 0 |
| Salt line | 0 | 0 |
| Tailwind | 0 | 0 |
| Seed rain | 0 | 0 |
| Thorn patch | 8 per second | 80% of regular reward for killing current slug type |

Slug position do not impact score for killing slugs using abilities. Score is rewarded only for killing the slug, not for using the item.

#### Game loop

Game is round based. Each round predetermined pool of slug spawns. Deeper the game - more slugs.
Round end condition: all slugs destroyed - round win. All pumkins destroyed - game over
After each round a popup appears. Popup contains a choice of 3 random cards
(pick 1, as before): usually an ability, rarely (15%) the card-exclusive
PEARcer piercing sniper (never sold in the shop). All other pumpkins are
shop-only and never appear as cards.

1 round - 1 popup
2 round - 2 popups
3 round - 3 popups
Capped at 3 popups, endless rounds

Popup can be skipped - player wont receive a reward. Popups are sequential

Player can exit the game between rounds - a button should just stop it and give a reward

#### Slug per round balance table

Round 1 (no shields — the tutorial round stays innocent):

time between spawns: 7 seconds

| Slug type | Amount | Speed variation |
| Scout | 20 | 1% |
| Marvin | 4 | 1% |

Round 2 (2 shielded):

time between spawns: 6 seconds

| Slug type | Amount | Speed variation |
| Scout | 16 | 2% |
| Marvin | 8 | 2% |

Round 3 (4 shielded):

time between spawns: 5 seconds

| Slug type | Amount | Speed variation |
| Scout | 20 | 4% |
| Marvin | 10 | 4% |
| Gerald | 2 | 4% |
| Dr. Dell Conagher | 1 | 0% |

Round 4 (6 shielded):

time between spawns: 3 seconds

| Slug type | Amount | Speed variation |
| Scout | 40 | 4% |
| Marvin | 16 | 4% |
| Gerald | 5 | 4% |
| Dr. Dell Conagher | 3 | 0% |

Round 5 (8 shielded):

time between spawns: 3 seconds

| Slug type | Amount | Speed variation |
| Scout | 48 | 4% |
| Marvin | 18 | 4% |
| Gerald | 6 | 4% |
| Dr. Dell Conagher | 4 | 0% |

Round 6 (10 shielded):

time between spawns: 2.5 seconds

| Slug type | Amount | Speed variation |
| Scout | 56 | 4% |
| Marvin | 20 | 4% |
| Gerald | 7 | 4% |
| Dr. Dell Conagher | 5 | 0% |

Round 7 (14 shielded):

time between spawns: 2.5 seconds

| Slug type | Amount | Speed variation |
| Scout | 64 | 4% |
| Marvin | 22 | 4% |
| Gerald | 8 | 4% |
| Dr. Dell Conagher | 5 | 0% |

Round 8 (14 shielded):

time between spawns: 3 seconds

| Slug type | Amount | Speed variation |
| Scout | 64 | 4% |
| Marvin | 20 | 4% |
| Gerald | 6 | 4% |
| Dr. Dell Conagher | 5 | 0% |

Round 9 (16 shielded):

time between spawns: 3 seconds

| Slug type | Amount | Speed variation |
| Scout | 72 | 4% |
| Marvin | 22 | 4% |
| Gerald | 7 | 4% |
| Dr. Dell Conagher | 5 | 0% |

Round 10 (18 shielded):

time between spawns: 3 seconds

| Slug type | Amount | Speed variation |
| Scout | 80 | 4% |
| Marvin | 24 | 4% |
| Gerald | 7 | 4% |
| Dr. Dell Conagher | 6 | 0% |

rounds 11+:

time between spawns: 3 seconds

| Slug type | Amount | Speed variation |
| Scout | round number * 8 | 4% |
| Marvin | round number * 2.5 | 4% |
| Gerald | sqrt(round number) * 1.2 | 4% |
| Dr. Dell Conagher | sqrt(round number) * 1.2 | 0% |
| Shielded | round number * 2 | - |

slug cound rounds via ceil().

Slugs spawns in random order every N seconds

#### Starting conditions

Player starts with 2 Ferdinands in inventory and they can place them just as regular pumkins. Starting coins: 20.

#### Line availability

Round 1 restricts play to the 3 center lanes: pumpkins can only be placed there and slugs only spawn there. From round 2 on, all 5 lanes open (locked lanes render dim, placement ghost turns red over them). Surviving round 1 with 3 lanes and then covering 2 fresh lanes is the round 2 filter.

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
1 epic item, 1 rare item, 1 uncommon item

If user reaches 6712 points on level 5 he is rewarded with:
1 rare item, 1 uncommon item

There are 5 pools of rewards:
0 - 999 - no reward
1000 - 1999 - common item
2000 - 4999 - uncommon item
5000 - 7999 - rare item
8000 - 11999 - epic item
12000+ - legendary item

Reward tiers and outline colors: common gray, uncommon green, rare blue, epic purple, legendary orange.

Bases are earned like accessories: every base except the free starter `base_a` (Classic) must be won in the minigame (at its assigned rarity tier) or granted by an admin. Locked items are shown in customization with a lock overlay and cannot be equipped (the backend rejects them).

All items are pumpkin decorations: bases plus hats, eyes, smiles, feet, etc.
Hats
- Party hat (rare)
- Frog hat (rare)
- Beret (common)

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

Currently, there are not assets - no sfx, no background images, no pumkins or slugs. Use placeholders from frontend/public/assets/hw26. Player pumpkin decorations (bases, hats, eyes, smiles, feet) are backend-owned: bundled placeholders live in backend/assets/user-pumpkins, uploads in &lt;dataDir&gt;/halloween, all served via GET /api/halloween/assets/{id} and composed per base in the Halloween assets admin tab.

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

## Battleground

Map is splitted into 5 horizontal lines (stripes). Slugs can spawn only on 1 of the line and they slowly crawl horizontally (they do not change direction to pumkin now)
Player can place pumkins only on the center of these lines: if he clicks on the stripe, pumkin is placed in the center (vertically) on it. There should be 6 horizontal spots for placement and user can select any of them
Pumkins also can shoot only horizontally (except Gwynevere - it shoots in parabolla shape, but can target only slugs in its line)

