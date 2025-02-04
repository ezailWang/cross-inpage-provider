import isFunction from 'lodash/isFunction';
import entries from 'lodash/entries';

import {
  IInjectedProviderNamesStrings,
  IJsBridgeConfig,
  IJsBridgeMessagePayload,
} from '@onekeyfe/cross-inpage-provider-types';

import { JsBridgeBase, consts } from '@onekeyfe/cross-inpage-provider-core';

const { EXT_PORT_CS_TO_BG, EXT_PORT_UI_TO_BG } = consts;

class JsBridgeExtBackground extends JsBridgeBase {
  constructor(config: IJsBridgeConfig) {
    super(config);
    this.setupMessagePortOnConnect();
  }

  sendAsString = false;

  public ports: Record<number | string, chrome.runtime.Port> = {};

  private portIdIndex = 1;

  sendPayload(payload0: IJsBridgeMessagePayload | string): void {
    const payload = payload0 as IJsBridgeMessagePayload;
    if (!payload.remoteId) {
      return;
    }
    const port: chrome.runtime.Port = this.ports[payload.remoteId as string];
    // TODO onDisconnect remove ports cache
    //    try catch error test
    try {
      port.postMessage(payload);
    } catch (err: any) {
      const error = err as Error;
      // TODO message maybe different in browser
      if (error && error?.message === 'Attempting to use a disconnected port object') {
        console.error('onDisconnect handler');
      }
      throw error;
    }
  }

  _getOriginFromPort(port: chrome.runtime.Port) {
    // chrome
    let origin = port?.sender?.origin || '';
    // firefox
    if (!origin && port?.sender?.url) {
      const uri = new URL(port?.sender?.url);
      origin = uri?.origin || '';
    }
    if (!origin) {
      console.error(this?.constructor?.name, 'ERROR: origin not found from port sender', port);
    }
    return origin;
  }

  setupMessagePortOnConnect() {
    // TODO removeListener
    chrome.runtime.onConnect.addListener((port) => {
      /* port.sender
                  frameId: 0
                  id: "nhccmkonbhjkihmkjcodcepopkjpldoa"
                  origin: "https://app.uniswap.org"
                  tab: {active: true, audible: false, autoDiscardable: true, discarded: false, favIconUrl: 'https://app.uniswap.org/favicon.png', …}
                  url: "https://app.uniswap.org/#/swap"
             */
      // content-script may be multiple
      if (port.name === EXT_PORT_CS_TO_BG || port.name === EXT_PORT_UI_TO_BG) {
        this.portIdIndex += 1;
        const portId = this.portIdIndex;
        this.ports[portId] = port;
        const onMessage = (payload: IJsBridgeMessagePayload, port0: chrome.runtime.Port) => {
          const origin = this._getOriginFromPort(port0);
          payload.remoteId = portId;
          // eslint-disable-next-line @typescript-eslint/no-this-alias
          const jsBridge = this;
          // TODO if EXT_PORT_CS_TO_BG ignore "internal_" prefix methods
          //    ignore scope=walletPrivate
          // - receive
          jsBridge.receive(payload, {
            origin,
            // only trust message from UI, but NOT from content-script(dapp)
            internal: port.name === EXT_PORT_UI_TO_BG,
          });
        };
        // #### content-script -> background
        port.onMessage.addListener(onMessage);

        // TODO onDisconnect remove ports cache
        const onDisconnect = () => {
          delete this.ports[portId];
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
        };
        port.onDisconnect.addListener(onDisconnect);
      }
    });
  }

  requestToAllCS(scope: IInjectedProviderNamesStrings, data: unknown) {
    // TODO optimize rename: broadcastRequest
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    entries(this.ports).forEach(async ([portId, port]) => {
      if (port.name === EXT_PORT_CS_TO_BG) {
        const origin = this._getOriginFromPort(port);
        if (isFunction(data)) {
          // eslint-disable-next-line no-param-reassign
          data = await data({ origin });
        }
        console.log(`notify to content-script port: ${portId}`, data);
        // TODO check ports disconnected
        this.requestSync({
          data,
          scope,
          remoteId: portId,
        });
      }
      void 0;
    });
  }

  requestToAllUi(data: unknown) {
    // TODO optimize
    entries(this.ports).forEach(([portId, port]) => {
      if (port.name === EXT_PORT_UI_TO_BG) {
        console.log(`notify to ui port: ${portId}`);
        // TODO check ports disconnected
        this.requestSync({
          data,
          remoteId: portId,
        });
      }
    });
  }
}

export { JsBridgeExtBackground };
