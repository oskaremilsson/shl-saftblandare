import { LocalStorage } from "node-localstorage";
const localStorage = new LocalStorage("./storage"); 

export const wait = (t, val) => {
  return new Promise(function(resolve) {
      setTimeout(function() {
          resolve(val);
      }, t);
  });
}

export const getCurrentSeason = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month < 6) {
    /* in january 2023 they're still playing season 2022 */
    return year - 1;
  }

  return year;
}

export const isLive = (live) => {
  return !live ? false : !!Object.keys(live).length;
};

export const isGamePaused = (status, previousStatus) => {
  const regex = /P(1|2) \/ Slut/;
  return !!status?.match(regex) && !previousStatus?.match(regex);
};

export const getHomeOrAway = (game, team) => {
  const key = Object.keys(game).find(k => game[k] === team);
  return key?.split("_")?.[0];
};

export const logger = (string, locale) => {
  string = `${new Date().toLocaleString(locale)}: ${string}`;
  console.log(string);

  const historyLog = JSON.parse(localStorage.getItem("history_log")) || [];
  /* keep the memory usage down */
  if (historyLog.length > 200) {
    while (historyLog.length) {
      historyLog.pop();
    }
  }

  historyLog.push(string);
  localStorage.setItem("history_log", JSON.stringify(historyLog));
};
