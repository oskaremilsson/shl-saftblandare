import * as dotenv from 'dotenv';
dotenv.config();
import fetch from "node-fetch";

import { LocalStorage } from "node-localstorage";
const localStorage = new LocalStorage("./storage"); 

import { wait } from "./utils.js";

const SECRET = process.env.OPENAPI_SHL_SECRET;
const CLIENT_ID = process.env.OPENAPI_SHL_CLIENT_ID;
const LOCALE = process.env.LOCALE || "sv-se";

class Api {
  constructor() {
    this.baseUrl = process.env.OPENAPI_SHL_BASE_URL;
    this.autoRefreshTimer;
  }

  async getToken() {
    try {
      console.log("Refreshing token");
      const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString("base64");
      const res = await fetch(`${this.baseUrl}/oauth2/token`, {
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
    
      this.handleTokenAutoRefresh(data);
    
      return token;
    } catch (err) {
      console.log(err);
      this.handleTokenAutoRefresh();
    }
  }

  async handleTokenAutoRefresh(data) {
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
    }

    /* refresh token whith 5 minutes left */
    const refreshIn = (data?.expires_in || 301) - 300;
    this.autoRefreshTimer = setTimeout(async () => {
      console.log("auto refresh");
      await this.getToken();
    }, refreshIn * 1000);
  }

  async call(path, query, retry = 0) {
    const token = localStorage.getItem("access_token") || await this.getToken();
    const queryString = query ? `?${new URLSearchParams(query)}` : "";
  
    try {
      localStorage.setItem("last_call", `${new Date().toLocaleString(LOCALE)}`);
      const res = await fetch(`${this.baseUrl}${path}${queryString}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        }
      });
    
      if (res?.status !== 200 && retry < 3) {
        console.log(`Failed to call api with status: ${res?.status}. Refreshing token and retrying..`);
        await this.getToken();
        await wait(1000);
    
        retry += 1;
        return await this.call(path, query, retry);
      }
    
      return await res?.json();
    } catch (err) {
      console.log(err);
    }
  }
}

const instance = new Api();
export { instance as Shl };
