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

export const getHomeOrAway = (game, team) => {
  const key = Object.keys(game).find(k => game[k] === team);
  return key?.split("_")?.[0];
};

export const logger = (string, historyLog, locale) => {
  string = `${new Date().toLocaleString(locale)}: ${string}`;
  console.log(string);

  if (historyLog) {
    /* keep the memory usage down */
    if (historyLog.length > 200) {
      while (historyLog.length) {
        historyLog.pop();
      }
    }

    historyLog.push(string);
  }
};
