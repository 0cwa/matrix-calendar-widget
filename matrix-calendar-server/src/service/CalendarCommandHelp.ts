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

export interface CalendarCommandHelp {
  title: string;
  intro: string;
  exampleLabel: string;
  sections: {
    title: string;
    commands: {
      syntax: string;
      description: string;
      example?: string;
    }[];
  }[];
  requirementsHeading: string;
  requirements: string[];
}

export interface FormattedCalendarCommandHelp {
  body: string;
  formattedBody: string;
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Build a safe Matrix custom-HTML body and its plain-text fallback. */
export function formatCalendarCommandHelp(
  help: CalendarCommandHelp,
): FormattedCalendarCommandHelp {
  const plainSections = help.sections.flatMap((section) => [
    section.title,
    ...section.commands.flatMap((command) => [
      command.syntax,
      `  ${command.description}`,
      ...(command.example
        ? [`  ${help.exampleLabel}: ${command.example}`]
        : []),
    ]),
    '',
  ]);

  const body = [
    help.title,
    help.intro,
    '',
    ...plainSections,
    help.requirementsHeading,
    ...help.requirements,
  ]
    .join('\n')
    .trimEnd();

  const formattedBody = [
    `<h2>${escapeHtml(help.title)}</h2>`,
    `<p>${escapeHtml(help.intro)}</p>`,
    ...help.sections.flatMap((section) => [
      `<h3>${escapeHtml(section.title)}</h3>`,
      `<ul>${section.commands
        .map((command) => {
          const example = command.example
            ? [
                `<br/><strong>${escapeHtml(help.exampleLabel)}:</strong>`,
                `<code>${escapeHtml(command.example)}</code>`,
              ].join(' ')
            : '';
          return [
            `<li><code>${escapeHtml(command.syntax)}</code><br/>`,
            escapeHtml(command.description),
            example,
            '</li>',
          ].join('');
        })
        .join('')}</ul>`,
    ]),
    `<h3>${escapeHtml(help.requirementsHeading)}</h3>`,
    `<ul>${help.requirements
      .map((requirement) => `<li>${escapeHtml(requirement)}</li>`)
      .join('')}</ul>`,
  ].join('');

  return { body, formattedBody };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ENTITIES[character] ?? character,
  );
}
