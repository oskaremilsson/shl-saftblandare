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
}

const checkForGoals = async (game, previousScore = 0, previousGameTime = "00:00") => {
  const gameReport = await callApi(`/seasons/${game?.season}/games/${game?.game_id}.json`);
  console.log(gameReport);
  const live = gameReport?.live;
  if (live?.status_string === "Slut") {
    return "Ended";
  }

  if (!!Object.keys(live).length) {
    const score = live?.[`${getHomeOrAway(game)}_score`];

    if (score > previousScore) {
      log(`New goal (${score} > ${previousScore}) found`);
      handleNewGoal();
    }

    if (live?.gametime === "20:00" && previousGameTime !== "20:00") {
      log(`Period ${live?.period} ended. Wait 16 minutes`);
      await wait(960000);
      log(`Next period is about to start. Checking for goals again...`);
    } else {
      await wait(10000);
    }

    await checkForGoals(game, score, live?.gametime);
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

const seasonLoop = async (season, games) => {
  /* wait for next game start time */
  const liveGame = await getNextLiveGame(games);

  log(`Game should be live now, start checking...`);
  /* finishes when game.live is {} or game.live.status_string is "Slut" */
  const gameStatus = await checkForGoals(liveGame);

  if (gameStatus === "Ended" || liveGame?.played) {
    log(`Game (${liveGame?.home_team_code} - ${liveGame?.away_team_code}) have ended`);

    /* refetch games when game ended, there might be new games (playoffs) or changes to schedule */
    games = await getGames(season);

    if (!games.length) {
      return "No more games";
    }
  } else {
    /* game should be live but isn't, wait and recheck */
    log(`Game (${liveGame?.home_team_code} - ${liveGame?.away_team_code}) is not yet live`);
    await wait(15000);
  }

  /* restart loop with remaining games */
  await loop(season, games);
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
