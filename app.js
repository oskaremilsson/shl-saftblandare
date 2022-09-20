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

const IP = os.networkInterfaces()?.en0?.[1]?.address;
const PORT = 1337;

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
  const json = await res?.json();
  const token = json?.access_token;
  localStorage.setItem("access_token", token);
  return token;
}

const callApi = async (path, query, retry = false) => {
  const token = localStorage.getItem("access_token") || await getToken();
  const queryString = query ? `?${new URLSearchParams(query)}` : "";

  const res = await fetch(`${BASE_URL}${path}${queryString}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });

  if (res?.status !== 200 && !retry) {
    await getToken();
    log("Failed to call api, refreshing token and retrying..");
    return await callApi(path, query, true);
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

const homeOrAway = (game) => {
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
  log(`Start the light!`);
  exec('ls ./', (err, _output) => {
    logError(err);
  });

  await wait(1000);

  log("Turn off the light");
  exec('ls ./', (err, _output) => {
    logError(err);
  });
}

const checkForGoals = async (season, game_id, homeAway, previous = 0) => {
  const game = await callApi(`/seasons/${season}/games/${game_id}.json`);
  console.log(game);
  if (game?.live_coverage_enabled) {
    const score = game.live[`${homeAway}_score`];

    if (score > previous) {
      log(`New goal (${score} > ${previous}) found`);
      await handleNewGoal();
    }

    await wait(10000);
    await checkForGoals(season, game_id, homeAway, score);
  }
};

const getNextLiveGame = async (games) => {
  const nextGame = games?.[0];

  const timeToNextGame = new Date(nextGame?.start_date_time) - new Date();
  if (timeToNextGame > 0 ) {
    log(`Waiting for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${nextGame?.start_date_time}`);
    await wait(timeToNextGame);
  }

  return nextGame;
};

const loop = async (season, games) => {
  /* wait for next game start time */
  const liveGame = await getNextLiveGame(games);

  if (liveGame?.live_coverage_enabled) {
    log(`Game should be live, start checking for goals...`);
    /* finishes when game.live_coverage_enabled is false */
    await checkForGoals(season, liveGame?.game_id, homeOrAway(liveGame));
  }

  /* remove game if played */
  if (liveGame?.played) {
    log(`Game (${liveGame?.home_team_code} - ${liveGame?.away_team_code}) have ended`);
    games = games.filter(g => g.game_id !== liveGame?.game_id);
    if (!games.length) {
      return "No more games";
    }
  } else {
    log(`Game (${liveGame?.home_team_code} - ${liveGame?.away_team_code}) is not yet live`);
    await wait(15000);
  }

  /* restart loop with remaining games */
  await loop(season, games);
}

const startApp = async () => {
  const season = getSeason();
  const games = await getGames(season);

  if (games.length) {
    /* loop finishes when there is no more games for the season */
    await loop(season, games);
  }

  /*
    wait 24 hours then try to refetch games for {season},
    this should just work for next season and next.. once the games becomes available
  */
  log(`No more games for season: ${season}, refetching games in 24 hours...`);
  await wait(24 * 60 * 60 * 1000);
  await startApp();
};

const server = http.createServer(async (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  res.end(`Running for ${TARGET_TEAM}\n${HISTORY_LOG.join("\n")}`);
});

server.listen(PORT, IP, async () => {
  console.log(`Server running at http://${IP}:${PORT}`);
  localStorage.removeItem("access_token");
  await startApp();
});
