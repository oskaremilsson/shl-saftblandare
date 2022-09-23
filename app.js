import * as dotenv from 'dotenv';
dotenv.config();

import os from "os";
import http from 'http';
import { LocalStorage } from "node-localstorage";
import fetch from 'node-fetch';
import { exec } from 'child_process';

const localStorage = new LocalStorage('./storage'); 

const BASE_URL = process.env.OPENAPI_SHL_BASE_URL;
const CLIENT_ID = process.env.OPENAPI_SHL_CLIENT_ID;
const SECRET = process.env.OPENAPI_SHL_SECRET;
const TARGET_TEAM = process.env.TARGET_TEAM;
const PORT = process.env.PORT || 1337;

const IP = os.networkInterfaces()?.en0?.[1]?.address;

const HISTORY_LOG = [];

const handleHistoryLog = () => {
  /* keep the memory usage down */
  if (HISTORY_LOG.length > 200) {
    while (HISTORY_LOG.length) {
      HISTORY_LOG.pop();
    }
  }
};

const log = (string) => {
  handleHistoryLog();

  string = `${new Date().toJSON()}: ${string}`;
  console.log(string);
  HISTORY_LOG.push(string);
};

const wait = (t, val) => {
  return new Promise(function(resolve) {
      setTimeout(function() {
          resolve(val);
      }, t);
  });
}

const getToken = async () => {
  const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials"
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    }
  });
  const data = await res?.json();
  const token = data?.access_token;
  localStorage.setItem("access_token", token);

  handleTokenAutoRefresh(data);

  return token;
}

const handleTokenAutoRefresh = async (data) => {
  /* refresh token whith 5 minutes left */
  const refreshIn = (data?.expires_in || 3600) - 300;
  setTimeout(async () => {
    await getToken();
  }, refreshIn * 1000);
}

const callApi = async (path, query, retry = 0) => {
  const token = localStorage.getItem("access_token") || await getToken();
  const queryString = query ? `?${new URLSearchParams(query)}` : "";

  const res = await fetch(`${BASE_URL}${path}${queryString}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });

  if (res?.status !== 200 && retry < 3) {
    log(`Failed to call api with status: ${res?.status}. Refreshing token and retrying..`);
    await getToken();
    await wait(1000);

    retry += 1;
    return await callApi(path, query, retry);
  }

  return await res?.json();
}

const getSeason = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month < 6) {
    return year -1;
  }

  return year;
}

const getGames = async (season) => {
  const games = await callApi(`/seasons/${season}/games.json`, { "teamIds[]": TARGET_TEAM });
  log(`Fetched games for season: ${season} and team: ${TARGET_TEAM}`);

  return games?.filter(g => !g.played)?.sort((a, b) => Date.parse(a.start_date_time) - Date.parse(b.start_date_time));
};

const getHomeOrAway = (game) => {
  const key = Object.keys(game).find(k => game[k] === TARGET_TEAM);
  return key?.split("_")?.[0];
};

const logError = (err) => {
  if (err) {
    HISTORY_LOG.push("Could not not exec");
    console.error("Could not execute command: ", err);
  }
};

const handleNewGoal = async () => {
  /* TODO: change to the real exec */
  log(`Start the light!`);
  exec('ls ./', (err, _output) => {
    logError(err);
  });

  await wait(15000);

  /* TODO: change to the real exec */
  log("Turn off the light");
  exec('ls ./', (err, _output) => {
    logError(err);
  });
};

const handleWaitTime = async (live, previousGameTime) => {
  /* pause for 16 minutes after period 1 and 2 finishes */ 
  if (live?.period < 3 && live?.gametime === "20:00" && previousGameTime !== "20:00") {
    log(`Period ${live?.period} ended. Wait 16 minutes`);
    await wait(960000);
    log(`Next period is about to start. Checking for goals again...`);
  } else {
    await wait(10000);
  }
};

const checkForNewGoals = (live, previousScore) => {
  const score = live?.[`${getHomeOrAway(live)}_score`];

  if (score > previousScore) {
    log(`New goal (${score} > ${previousScore}) found`);
    handleNewGoal();
  }

  return score;
};

const isLive = (live) => {
  return !live ? false : !!Object.keys(live).length;
};

/* return next game when it schedule to start */
const getNextGameWhenLive = async (games) => {
  const nextGame = games?.[0];
  const timeToNextGame = new Date(nextGame?.start_date_time) - new Date();

  if (timeToNextGame > 2147483646) {
    /* failsafe if next game is more than 24 days away */
    log(`Waiting max time for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${nextGame?.start_date_time}`);
    await wait(2147483646);
  } else if (timeToNextGame > 0) {
    log(`Waiting for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${nextGame?.start_date_time}`);
    await wait(timeToNextGame);
  } else {
    log(`Start time for ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${nextGame?.start_date_time} has already passed`);
  }

  return nextGame;
};

/*
  loops until game.live is {} or game.live.status_string is "Slut"
  or returns if game is not yet live
*/
const gameLoop = async (game, previousScore = 0, previousGameTime = "00:00") => {
  const gameReport = await callApi(`/seasons/${game?.season}/games/${game?.game_id}.json`);
  console.log(gameReport);
  const live = gameReport?.live;

  if (gameReport?.played || live?.status_string === "Slut") {
    return "Ended";
  }

  if (isLive(live)) {
    const score = checkForNewGoals(live, previousScore);
    await handleWaitTime(live, previousGameTime);
    await gameLoop(game, score, live?.gametime);
  }
};

/* loops until there is no more games for the team dring the set season */
const seasonLoop = async (season, games) => {
  const liveGame = await getNextGameWhenLive(games);
  log(`Game should be live now, start checking...`);
  const gameStatus = await gameLoop(liveGame);

  if (gameStatus === "Ended") {
    /* refetch games, there might be new games (playoffs) or changes to schedule */
    games = await getGames(season);
  } else {
    /* game should be live but isn't, wait and recheck */
    log(`Game (${liveGame?.home_team_code} - ${liveGame?.away_team_code}) is not yet live`);
    await wait(15000);
  }

  if (!games.length) {
    return "No more games";
  } else {
    await seasonLoop(season, games);
  }
}

const mainLoop = async () => {
  const season = getSeason();
  const games = await getGames(season);

  if (games?.length) {
    /* loop finishes when there is no more games for the season */
    await seasonLoop(season, games);
  }

  /*
    wait 24 hours then try to refetch games for {season},
    this should just work for next season and next.. once the games becomes available
  */
  log(`No more games for season: ${season}, refetching games in 24 hours...`);
  await wait(24 * 60 * 60 * 1000);
  await mainLoop();
};

const server = http.createServer(async (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  res.end(`Running for ${TARGET_TEAM}\n${HISTORY_LOG.join("\n")}`);
});

server.listen(PORT, IP, async () => {
  console.log(`Server running at http://${IP}:${PORT}`);
  localStorage.removeItem("access_token");
  await mainLoop();
});
