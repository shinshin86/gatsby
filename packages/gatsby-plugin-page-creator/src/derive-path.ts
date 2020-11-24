import _ from "lodash"
import slugify from "@sindresorhus/slugify"
import { Reporter } from "gatsby"
import {
  extractFieldWithoutUnion,
  extractAllCollectionSegments,
  switchToPeriodDelimiters,
  stripTrailingSlash,
} from "./path-utils"

const doubleForwardSlashes = /\/\/+/g

// Generates the path for the page from the file path
// product/{Product.id} => /product/:id, pulls from nodes.id
// product/{Product.sku__en} => product/:sku__en pulls from nodes.sku.en
// blog/{MarkdownRemark.parent__(File)__relativePath}} => blog/:slug pulls from nodes.parent.relativePath
export function derivePath(
  path: string,
  node: Record<string, unknown>,
  reporter: Reporter
): { errors: number; derivedPath: string } {
  // 0. Since this function will be called for every path times count of nodes the errors will be counted and then the calling function will throw the error once
  let errors = 0

  // 1.  Incoming path can optionally be stripped of file extension (but not mandatory)
  let modifiedPath = path

  // 2.  Pull out the slug parts that are within { } brackets.
  const slugParts = extractAllCollectionSegments(path)

  // 3.  For each slug parts get the actual value from the node data
  slugParts.forEach(slugPart => {
    // 3.a.  this transforms foo__bar into foo.bar
    const cleanedField = extractFieldWithoutUnion(slugPart)[0]
    const key = switchToPeriodDelimiters(cleanedField)

    // 3.b  Get the value
    const nodeValue = _.get(node, key)

    // 3.c  log error if the key does not exist on node
    if (nodeValue === undefined) {
      if (process.env.gatsby_log_level === `verbose`) {
        reporter.verbose(
          `Could not find value in the following node for key ${slugPart} (transformed to ${key}) for node:

        ${JSON.stringify(node, null, 2)}`
        )
      }

      errors++

      return
    }

    // 3.d  Safely slugify all values (to keep URL structures) and remove any trailing slash
    const value = stripTrailingSlash(safeSlugify(nodeValue as string))

    // 3.e  replace the part of the slug with the actual value
    modifiedPath = modifiedPath.replace(slugPart, value)
  })

  // 4.  Remove double forward slashes that could occur in the final URL
  modifiedPath = modifiedPath.replace(doubleForwardSlashes, `/`)

  const derivedPath = modifiedPath

  return {
    errors,
    derivedPath,
  }
}

// If the node value is meant to be a slug, like `foo/bar`, the slugify
// function will remove the slashes. This is a hack to make sure the slashes
// stick around in the final url structuring
function safeSlugify(nodeValue: string): string {
  // The incoming GraphQL data can also be a number
  const input = String(nodeValue)
  const tempArr = input.split(`/`)

  return tempArr.map(v => slugify(v)).join(`/`)
}
