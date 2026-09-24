/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { XMLParser } from 'fast-xml-parser';
import { CalDavCredentialProvider } from './CalDavCredentialProvider';

export type DiscoveredCalDavCalendar = {
  href: string;
  displayName?: string;
  color?: string;
  components?: string[];
  readOnly?: boolean;
};

export type CalDavDiscoveryResult = {
  principalUrl: string;
  calendarHomeUrl: string;
  calendars: DiscoveredCalDavCalendar[];
};

export class CalDavDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'CalDavDiscoveryError';
  }
}

type DavNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const PRINCIPAL_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`;

const HOME_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`;

const CALENDARS_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind
  xmlns:D="DAV:"
  xmlns:C="urn:ietf:params:xml:ns:caldav"
  xmlns:A="http://apple.com/ns/ical/"
>
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
    <D:current-user-privilege-set/>
    <C:supported-calendar-component-set/>
    <A:calendar-color/>
  </D:prop>
</D:propfind>`;

function createCalendarBody(displayName: string): string {
  return `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXmlText(displayName)}</D:displayname>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;
}

export class CalDavDiscoveryClient {
  constructor(
    private readonly baseUrl: string,
    private readonly credentialProvider: CalDavCredentialProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCalendar(
    displayName: string,
    collectionName: string,
  ): Promise<DiscoveredCalDavCalendar> {
    const name = displayName.trim();
    if (!name) {
      throw new CalDavDiscoveryError('Calendar display name must not be empty');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(collectionName)) {
      throw new CalDavDiscoveryError('Calendar collection name is invalid');
    }

    const { calendarHomeUrl } = await this.discoverHome();
    const collectionBase = new URL(calendarHomeUrl);
    if (!collectionBase.pathname.endsWith('/')) {
      collectionBase.pathname = `${collectionBase.pathname}/`;
    }
    const collectionUrl = new URL(
      `${collectionName}/`,
      collectionBase,
    ).toString();

    const credentialHeaders = await this.credentialProvider.getRequestHeaders();
    const headers = new Headers(credentialHeaders);
    headers.set('Content-Type', 'application/xml; charset=utf-8');

    const response = await this.fetchImpl(collectionUrl, {
      method: 'MKCALENDAR',
      headers,
      body: createCalendarBody(name),
    });

    if (!response.ok) {
      throw new CalDavDiscoveryError(
        `CalDAV MKCALENDAR failed with status ${response.status}`,
        response.status,
        collectionUrl,
      );
    }

    return {
      href: collectionUrl,
      displayName: name,
      components: ['VEVENT'],
      readOnly: false,
    };
  }

  async discover(): Promise<CalDavDiscoveryResult> {
    const { principalUrl, calendarHomeUrl } = await this.discoverHome();
    const responses = await this.propfind(calendarHomeUrl, '1', CALENDARS_BODY);
    const calendars = responses.flatMap((response) => {
      const properties = successfulProperties(response);
      if (!isCalendarCollection(properties.resourcetype)) {
        return [];
      }

      const componentProperty = properties['supported-calendar-component-set'];
      const components = componentProperty
        ? componentNames(componentProperty)
        : undefined;

      if (components && !components.includes('VEVENT')) {
        return [];
      }

      const href = textValue(response.href);
      if (!href) {
        return [];
      }

      return [
        {
          href: new URL(href, calendarHomeUrl).toString(),
          displayName: textValue(properties.displayname),
          color: textValue(properties['calendar-color']),
          components,
          readOnly: readOnlyValue(properties['current-user-privilege-set']),
        },
      ];
    });

    return {
      principalUrl,
      calendarHomeUrl,
      calendars,
    };
  }

  private async discoverHome(): Promise<{
    principalUrl: string;
    calendarHomeUrl: string;
  }> {
    const serviceUrl = new URL(this.baseUrl).toString();
    const principalHref = await this.discoverHref(
      serviceUrl,
      PRINCIPAL_BODY,
      'current-user-principal',
    );
    const principalUrl = new URL(principalHref, serviceUrl).toString();

    const calendarHomeHref = await this.discoverHref(
      principalUrl,
      HOME_BODY,
      'calendar-home-set',
    );

    return {
      principalUrl,
      calendarHomeUrl: new URL(calendarHomeHref, principalUrl).toString(),
    };
  }

  private async discoverHref(
    url: string,
    body: string,
    propertyName: string,
  ): Promise<string> {
    const responses = await this.propfind(url, '0', body);

    for (const response of responses) {
      const property = successfulProperties(response)[propertyName];
      const href = textValue(asNode(property)?.href);
      if (href) {
        return href;
      }
    }

    throw new CalDavDiscoveryError(
      `CalDAV response did not include ${propertyName}`,
      undefined,
      url,
    );
  }

  private async propfind(
    url: string,
    depth: '0' | '1',
    body: string,
  ): Promise<DavNode[]> {
    const credentialHeaders = await this.credentialProvider.getRequestHeaders();
    const headers = new Headers(credentialHeaders);
    headers.set('Content-Type', 'application/xml; charset=utf-8');
    headers.set('Depth', depth);

    const response = await this.fetchImpl(url, {
      method: 'PROPFIND',
      headers,
      body,
    });

    if (!response.ok) {
      throw new CalDavDiscoveryError(
        `CalDAV PROPFIND failed with status ${response.status}`,
        response.status,
        url,
      );
    }

    const xml = await response.text();
    const document = asNode(parser.parse(xml));
    const multistatus = asNode(document?.multistatus);
    return asArray(multistatus?.response).flatMap((value) => {
      const node = asNode(value);
      return node ? [node] : [];
    });
  }
}

function successfulProperties(response: DavNode): DavNode {
  const result: DavNode = {};

  for (const propstatValue of asArray(response.propstat)) {
    const propstat = asNode(propstatValue);
    const status = textValue(propstat?.status);
    if (!status?.includes(' 200 ')) {
      continue;
    }

    Object.assign(result, asNode(propstat?.prop) ?? {});
  }

  return result;
}

function isCalendarCollection(resourceType: unknown): boolean {
  const node = asNode(resourceType);
  return Boolean(
    node && Object.prototype.hasOwnProperty.call(node, 'calendar'),
  );
}

function componentNames(componentSet: unknown): string[] {
  const node = asNode(componentSet);
  return asArray(node?.comp).flatMap((component) => {
    const name = textValue(asNode(component)?.['@_name']);
    return name ? [name.toUpperCase()] : [];
  });
}

function readOnlyValue(privilegeSet: unknown): boolean | undefined {
  const node = asNode(privilegeSet);
  if (!node) {
    return undefined;
  }

  const privilegeNames = asArray(node.privilege).flatMap((privilege) =>
    Object.keys(asNode(privilege) ?? {}),
  );

  return !privilegeNames.some(
    (privilege) =>
      privilege === 'all' ||
      privilege === 'write' ||
      privilege === 'write-content',
  );
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function asNode(value: unknown): DavNode | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as DavNode)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
