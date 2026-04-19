import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vp/test'

const changesetDir = path.resolve(import.meta.dirname, '../../.changeset')

describe('changesets', () => {
  test('all changeset files have valid frontmatter fences', () => {
    const files = fs
      .readdirSync(changesetDir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')

    for (const file of files) {
      const content = fs.readFileSync(path.join(changesetDir, file), 'utf-8')
      expect(content, `${file} must start with "---"`).toMatch(/^---\n/)
      expect(
        content.indexOf('---', 3),
        `${file} must have closing "---" frontmatter fence`,
      ).toBeGreaterThan(3)
    }
  })
})
