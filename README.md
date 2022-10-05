# shl-saftblandare
This is the code part of a birthday present I made for my brother in law.

It checks for when `TARGET_TEAM` scores in SHL, and when they do, exec given command by `GOAL_ON_CMD`, then `GOAL_OFF_CMD`. In our case - urn USB on/off to turn a blue rotating light on/off.

## How?
* A node app is using [SHL Open API](http://doc.openapi.shl.se/) to check for live goals.
  - See [.env.example](.env.example) for all envs used.
* A python script that checks for a button-press to manually toggle the light.

The code have 3 recursive loops that _should_ make it run for all future seasons automatically.

### mainLoop
The starting point of the app.
* check for the current `season`. _(named after the year **it started** in the API)_
* fetch `games` for the `season`.
* if `games`:
  - launch `SeasonLoop`.
* if not:
  - wait `24 hours`.
  - restart `mainLoop`.

### seasonLoop
* waits for `start_date_time` of next game.
* launch `GameLoop` when `start_date_time` have passed.
* waits 15 minutes after game ended.
* fetch `games` for the `season`.
* if more games for the season:
  - restart `seasonLoop`.
* if not:
  - end `seasonLoop`.

### gameLoop
* fetch detailed `gameReport` information
* if game ended:
  - return `game_ended`.
* if `live`:
  - check for new scores from `TARGET_TEAM`
  - wait `POLL_TIME`
  - restart `gameLoop`
* if not `live`:
  - wait `15 seconds`.
  - if more than 2 hours after `start_date_time`
    - return `game_not_started`. 
  - if not
    - restart `gameLoop`.

![image](https://user-images.githubusercontent.com/8742118/194004197-7bd68654-c7f7-4ea3-a19a-a93c5c03e02c.png)
