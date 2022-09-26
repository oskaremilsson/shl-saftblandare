import * as dotenv from 'dotenv';
dotenv.config();
import fetch from "node-fetch";

import { LocalStorage } from "node-localstorage";
const localStorage = new LocalStorage("./storage"); 

import { wait } from "./utils.js";

const SECRET = process.env.OPENAPI_SHL_SECRET;
const CLIENT_ID = process.env.OPENAPI_SHL_CLIENT_ID;

class Api {
  constructor() {
    this.baseUrl = process.env.OPENAPI_SHL_BASE_URL;
  }

  async getToken() {
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
  }

  async handleTokenAutoRefresh(data) {
    /* refresh token whith 5 minutes left */
    const refreshIn = (data?.expires_in || 3600) - 300;
    setTimeout(async () => {
      await this.getToken();
    }, refreshIn * 1000);
  }

  async call(path, query, retry = 0) {
    const token = localStorage.getItem("access_token") || await this.getToken();
    const queryString = query ? `?${new URLSearchParams(query)}` : "";
  
    const res = await fetch(`${this.baseUrl}${path}${queryString}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      }
    });
  
    if (res?.status !== 200 && retry < 3) {
      log(`Failed to call api with status: ${res?.status}. Refreshing token and retrying..`);
      await this.getToken();
      await wait(1000);
  
      retry += 1;
      return await this.call(path, query, retry);
    }
  
    return await res?.json();
  }
}

const instance = new Api();
export { instance as Shl };
