import * as dotenv from 'dotenv';
dotenv.config();

import { LocalStorage } from "node-localstorage";
const localStorage = new LocalStorage('./storage');

import os from "os";
import http from 'http';
import { exec } from 'child_process';

import { Shl } from "./api.js";
import { wait, getMsTimeUntilNextDay, logger, getCurrentSeason, isLive, isGamePaused, getAOrB, } from "./utils.js";

const HOSTNAME = process.env.HOSTNAME || os.networkInterfaces()?.en0?.[1]?.address;
const PORT = process.env.PORT || 1337;
const LOCALE = process.env.LOCALE || "sv-se";

const TARGET_TEAM = process.env.TARGET_TEAM || "LIF";
const POLL_TIME = process.env.POLL_TIME || 10000;

const GOAL_ON_CMD = process.env.GOAL_ON_CMD;
const GOAL_OFF_CMD = process.env.GOAL_OFF_CMD;
const GOAL_TIME = process.env.GOAL_TIME;
const EXEC_CMD = process.env.EXEC_CMD === "true" || false;

const log = (string) => logger(string, LOCALE);

const fetchInterestedGame = async () => {
  localStorage.setItem("last_call", `${new Date().toLocaleString(LOCALE)}`);
  const res = await fetch(`https://www.sportfane.se/Com.svc/Main?v=1_01`);
  const data = await res?.json();
  const game = data?.games;
  return game?.filter(g => [g?.teamA, g?.teamB].includes(TARGET_TEAM))?.[0];
}

const getTodaysGame = async () => {
  const interestedGame = fetchInterestedGame();
  return interestedGame;
  return interestedGame?.finished ? null : interestedGame;
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

const checkForNewGoals = (gameReport, previousScore) => {
  const score = gameReport?.[`score${getAOrB(gameReport, TARGET_TEAM)}`];
  console.log(score);

  if (score > previousScore) {
    activeLight(GOAL_TIME, "New goal!");
  }

  return score;
};

/*
  loops until game.finished is true (ended)
*/
const gameLoop = async (previousScore = 0) => {
  const gameReport = await fetchInterestedGame();
  const live = gameReport?.started;
  log("gameloop again");

  if (gameReport?.finished) {
    log(`Game ended. Found ${previousScore} goals for ${TARGET_TEAM}. But it ended with ${gameReport?.[`score${getAOrB(gameReport, TARGET_TEAM)}`]} for ${TARGET_TEAM}`);
    return "game_ended";
  }

  if (live) {
    const score = checkForNewGoals(gameReport, previousScore);

    await wait(POLL_TIME);

    return await gameLoop(score);
  } else {
    const matchDate = new Date();
    const hour = gameReport?.time_matchstart?.split(":")?.[0];
    const minute = gameReport?.time_matchstart?.split(":")?.[1];
    matchDate?.setHours(Number(hour), Number(minute), 0, 0);

    const timeSinceStartTime = new Date() - matchDate;
    /* game should be live but isn't, wait and recheck */
    await wait(15000);

    if (timeSinceStartTime > (2 * 60 * 60 * 1000)) {
      // it's been two hours without gamestart. give up
      return "game_not_started";
    }

    return await gameLoop(game);
  }
};

const mainLoop = async () => {
  //const season = getCurrentSeason();
  const game = await getTodaysGame();
  console.log(game);

  if (game) {
    log(`It's game day!`);

    const matchDate = new Date();
    const hour = game?.time_matchstart?.split(":")?.[0];
    const minute = game?.time_matchstart?.split(":")?.[1];
    matchDate?.setHours(Number(hour), Number(minute), 0, 0);

    const now = new Date().getTime();
    const matchStart = matchDate?.getTime();
    log(`waiting ${matchStart - now} ms until game starts at ${matchDate?.toLocaleString(LOCALE)}`);
    await wait(matchStart - now);

    await gameLoop();
  }

  /*
    not game day today, check tomorrow at noon.
  */
  const date = new Date((new Date).getTime() + getMsTimeUntilNextDay());
  log(`No more games for today, refetching games tomorrow, waiting ${date.toLocaleString(LOCALE)}`);
  await wait(getMsTimeUntilNextDay());
  return await mainLoop();
};

/* For debug purposes, open up a web server that show the last 200 history logs */
const server = http.createServer(async (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  const historyLog = JSON.parse(localStorage.getItem("history_log")) || [];

  res.end(`Running for ${TARGET_TEAM}\nLast call: ${localStorage.getItem("last_call")}\n${historyLog.join("\n")}`);
});

server.listen(PORT, HOSTNAME, async () => {
  console.log(`Server running at http://${HOSTNAME}:${PORT}`);
  localStorage.removeItem("access_token");
  log("Restarting app...\n");
  await mainLoop();
});
