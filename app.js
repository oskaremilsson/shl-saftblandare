import * as dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { LocalStorage } from "node-localstorage";
import fetch from 'node-fetch';
import { exec } from 'child_process';

const localStorage = new LocalStorage('./storage'); 

const BASE_URL = process.env.OPENAPI_SHL_BASE_URL;
const CLIENT_ID = process.env.OPENAPI_SHL_CLIENT_ID;
const SECRET = process.env.OPENAPI_SHL_SECRET;
const TARGET_TEAM = process.env.TARGET_TEAM;

const HOSTNAME = "127.0.0.1";
const PORT = 1337;

const HISTORY_LOG = [];

/*const mockGames = [
  {
    "game_id": 0,
    "game_uuid": "d4a423c7-ab5c-41d3-996f-8a69dffa444a",
    "season": "2022",
    "game_type": "regular",
    "round_number": 0,
    "start_date_time": "2022-09-09T13:51:55.343Z",
    "home_team_code": "FBK",
    "home_team_result": 0,
    "away_team_code": "LIF",
    "away_team_result": 0,
    "played": true,
  },
  {
    "game_id": 1,
    "game_uuid": "fg4423c7-ab5c-41d3-996f-8a69dffadf34",
    "season": "2022",
    "game_type": "regular",
    "round_number": 0,
    "start_date_time": "2022-09-19T19:53:55.343Z",
    "home_team_code": "LIF",
    "home_team_result": 0,
    "away_team_code": "HV71",
    "away_team_result": 0,
    "played": false,
  },
  {
    "game_id": 2,
    "game_uuid": "kl7423c7-ab5c-41d3-996f-8a69dffadf45",
    "season": "2022",
    "game_type": "regular",
    "round_number": 0,
    "start_date_time": "2022-09-21T19:54:55.343Z",
    "home_team_code": "LIF",
    "home_team_result": 0,
    "away_team_code": "OIK",
    "away_team_result": 0,
    "played": false,
  }
];

const mockGame = {
  live: {
    "gametime": "string",
    "time_period": 0,
    "game_id": 1,
    "period": 0,
    "round": 0,
    "home_team_code": "LIF",
    "home_score": 0,
    "away_team_code": "HV71",
    "away_score": 0,
    "venue": "string",
    "attendance": 0,
    "status_string": "string"
  },
  "game_id": 1,
  "game_uuid": "fg4423c7-ab5c-41d3-996f-8a69dffadf34",
  "season": "2022",
  "game_type": "regular",
  "round_number": 0,
  "start_date_time": "2022-09-21T13:51:55.343Z",
  "home_team_code": "LIF",
  "home_team_result": 0,
  "away_team_code": "HV71",
  "away_team_result": 0,
  "played": false
};*/

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
    console.log("Failed to call api, refreshing token and retrying..");
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
  console.log(`Fetched games for season: ${season} and team: ${TARGET_TEAM}`);
  HISTORY_LOG.push(`Fetched games for season: ${season} and team: ${TARGET_TEAM}`);

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
  console.log("Start the light");
  HISTORY_LOG.push(`Start the light!`);

  exec('ls ./', (err, _output) => {
    logError(err);
  });
  await wait(1000);
  console.log("Turn off the light");
  HISTORY_LOG.push(`Turn off the light!`);

  exec('ls ./', (err, _output) => {
    logError(err);
  });
}

const getGoals = async (season, game_id, homeAway, previous = 0) => {
  const game = await callApi(`/seasons/${season}/games/${game_id}.json`);
  console.log(game);
  if (game?.live[`${homeAway}_score`]) {
    const score = game.live[`${homeAway}_score`];
    console.log("score: " + score);

    if (score > previous) {
      console.log(`New goal (${score} > ${previous}) found`);
      HISTORY_LOG.push(`New goal (${score} > ${previous}) found`);
      await handleNewGoal();
    }

    await wait(10000);
    await getGoals(season, game_id, homeAway, previous);
  }
};

const wait = (t, val) => {
  return new Promise(function(resolve) {
      setTimeout(function() {
          resolve(val);
      }, t);
  });
}

const handleHistoryLog = () => {
  /* keep the memory usage down */
  if (HISTORY_LOG.length > 200) {
    while (HISTORY_LOG.length) {
      HISTORY_LOG.pop();
    }
  }
};

const check = async (season, games) => {
  handleHistoryLog();

  const nextGame = games?.[0];
  const timeToNextGame = new Date(nextGame?.start_date_time) - new Date();

  console.log(`Waiting for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${nextGame?.start_date_time}`);
  HISTORY_LOG.push(`Waiting for next game: ${nextGame?.home_team_code} - ${nextGame?.away_team_code} at ${nextGame?.start_date_time}`);

  if (timeToNextGame > 0 ) {
    await wait(timeToNextGame);
  }

  HISTORY_LOG.push(`Game should be live now, start checking for goals...`);
  await getGoals(season, nextGame?.game_id, homeOrAway(nextGame));

  HISTORY_LOG.push("Game not live (yet or have ended) refreshing games in 15 seconds");
  console.log("Game not live (yet or have ended) refreshing games in 15 seconds");
  await wait(15000);
  const newGames = await getGames(season);
  await check(season, newGames);
}

const startApp = async () => {
  const season = getSeason();
  const games = await getGames(season);
  await check(season, games);

  HISTORY_LOG.push(`No more games for season: ${season}, checking again tomorrow...`);
  console.log(`No more games for season: ${season}, checking again tomorrow...`);
  await wait(24 * 60 * 60 * 1000)
  await startApp();
};

const server = http.createServer(async (_req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  res.end(`Running for ${TARGET_TEAM}\n${HISTORY_LOG.join("\n")}`);
});

server.listen(PORT, HOSTNAME, async () => {
  console.log(`Server running at http://${HOSTNAME}:${PORT}`);
  await startApp();
});
