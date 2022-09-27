import * as dotenv from 'dotenv';
dotenv.config();

import { LocalStorage } from "node-localstorage";
const localStorage = new LocalStorage('./storage');

import os from "os";
import http from 'http';
import { exec } from 'child_process';

import { Shl } from "./api.js";
import { wait, logger, getCurrentSeason, isLive, getHomeOrAway, } from "./utils.js";

const HOSTNAME = process.env.HOSTNAME || os.networkInterfaces()?.en0?.[1]?.address;
const PORT = process.env.PORT || 1337;

const TARGET_TEAM = process.env.TARGET_TEAM;
const LOCALE = process.env.LOCALE || "sv-se";
const GOAL_ON_CMD = process.env.GOAL_ON_CMD;
const GOAL_OFF_CMD = process.env.GOAL_OFF_CMD;
const EXEC_CMD = process.env.EXEC_CMD === "true" || false;

const HISTORY_LOG = [];

const log = (string) => logger(string, HISTORY_LOG, LOCALE);

const getGames = async (season) => {
  const games = await Shl.call(`/seasons/${season}/games.json`, { "teamIds[]": TARGET_TEAM }) || [];
  const unplayedGames = games?.filter(g => !g.played)?.sort((a, b) => Date.parse(a.start_date_time) - Date.parse(b.start_date_time));

  log(`${unplayedGames?.length} games remaining for ${TARGET_TEAM} in season ${season}`);
  return unplayedGames;
};

const activeLight = async (time, reason) => {
  log(`Start the light! ${reason}`);

  if (EXEC_CMD) {
    exec(GOAL_ON_CMD);
    await wait(time);
    exec(GOAL_OFF_CMD);
  }

  log("Turn off the light");
};

const checkForNewGoals = (live, previousScore) => {
  const score = live?.[`${getHomeOrAway(live, TARGET_TEAM)}_score`];

  if (score > previousScore) {
    activeLight(15000, "New goal!");
  }

  return score;
};

/* return next game when it schedule to start */
const getNextGameWhenLive = async (games) => {
  const nextGame = games?.[0];
  const timeToNextGame = new Date(nextGame?.start_date_time) - new Date();
  const startTime = new Date(nextGame?.start_date_time).toLocaleString(LOCALE);

  if (timeToNextGame > 2147483646) {
    /* failsafe for max of int if next game is more than 24 days away */
    log(`Waiting max time for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${startTime}`);
    await wait(2147483646);
  } else if (timeToNextGame > 0) {
    log(`Waiting for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${startTime}`);
    await wait(timeToNextGame);
  } else {
    log(`Start time for ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${startTime} has already passed`);
  }

  return nextGame;
};

/*
  loops until game.live is {} (not live) or game.played is true (ended)
*/
const gameLoop = async (game, previousScore = 0) => {
  const gameReport = await Shl.call(`/seasons/${game?.season}/games/${game?.game_id}.json`) || {};
  console.log(gameReport);
  const live = gameReport?.live;

  if (gameReport?.played) {
    log(`Game ended: ${TARGET_TEAM} made ${previousScore} goals.`);
    return "game_ended";
  }

  if (isLive(live)) {
    const score = checkForNewGoals(live, previousScore);
    await wait(10000);
    return await gameLoop(game, score);
  }
};

/* loops until there is no more games for the team dring the set season */
const seasonLoop = async (season, games) => {
  const liveGame = await getNextGameWhenLive(games);
  log(`Game should be live now, start checking...`);
  const gameStatus = await gameLoop(liveGame);

  if (gameStatus === "game_ended") {
    log(`Fetching new games in 10 minutes.`);
    await wait(900000);
    games = await getGames(season);
  } else {
    /* game should be live but isn't, wait and recheck */
    log(`Game (${liveGame?.home_team_code} - ${liveGame?.away_team_code}) is not yet live.`);
    await wait(15000);
  }

  if (!games.length) {
    return "No more games";
  } else {
    await seasonLoop(season, games);
  }
}

const mainLoop = async () => {
  const season = getCurrentSeason();
  const games = await getGames(season);

  if (games?.length) {
    activeLight(1000, "App is ready");
    await seasonLoop(season, games);
  }

  /*
    wait 24 hours then try to refetch games for relevant season based on current date,
    once the games becomes available for new season it will start a new seasonLoop.
  */
  log(`No more games for season: ${season}, refetching games in 24 hours...`);
  await wait(24 * 60 * 60 * 1000);
  await mainLoop();
};

/* For debug purposes, open up a web server that show the last 200 history logs */
const server = http.createServer(async (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  res.end(`Running for ${TARGET_TEAM}\n${HISTORY_LOG.join("\n")}`);
});

server.listen(PORT, HOSTNAME, async () => {
  console.log(`Server running at http://${HOSTNAME}:${PORT}`);
  localStorage.removeItem("access_token");
  await mainLoop();
});
