// Move this to gatsby-core-utils?
import { Actions, CreatePagesArgs } from "gatsby"
import { createPath } from "gatsby-page-utils"
import { Reporter } from "gatsby"
import { reverseLookupParams } from "./extract-query"
import { getMatchPath } from "./get-match-path"
import { getCollectionRouteParams } from "./get-collection-route-params"
import { derivePath } from "./derive-path"
import { watchCollectionBuilder } from "./watch-collection-builder"
import { collectionExtractQueryString } from "./collection-extract-query-string"
import { isValidCollectionPathImplementation } from "./is-valid-collection-path-implementation"
import { CODES, prefixId } from "./error-utils"

// TODO: Do we need the ignore argument?
export async function createPagesFromCollectionBuilder(
  filePath: string,
  absolutePath: string,
  actions: Actions,
  graphql: CreatePagesArgs["graphql"],
  reporter: Reporter
): Promise<void> {
  if (isValidCollectionPathImplementation(absolutePath, reporter) === false) {
    watchCollectionBuilder(absolutePath, ``, [], actions, reporter, () =>
      createPagesFromCollectionBuilder(
        filePath,
        absolutePath,
        actions,
        graphql,
        reporter
      )
    )
    return
  }

  // 1. Query for the data for the collection to generate pages
  const queryString = collectionExtractQueryString(absolutePath, reporter)

  // 1.a  If the query string is not findable, we can't move on. So we stop and watch
  if (queryString === null) {
    watchCollectionBuilder(absolutePath, ``, [], actions, reporter, () =>
      createPagesFromCollectionBuilder(
        filePath,
        absolutePath,
        actions,
        graphql,
        reporter
      )
    )
    return
  }

  const { data, errors } = await graphql<
    { nodes: Record<string, unknown> } | { group: Record<string, unknown> }
  >(queryString)

  // 1.a If it fails, we need to inform the user and exit early
  if (!data || errors) {
    reporter.error({
      id: prefixId(CODES.CollectionBuilder),
      context: {
        sourceMessage: `Tried to create pages from the collection builder.
Unfortunately, the query came back empty. There may be an error in your query:

${errors.map(error => error.message).join(`\n`)}`.trim(),
      },
      filePath: absolutePath,
    })

    watchCollectionBuilder(
      absolutePath,
      queryString,
      [],
      actions,
      reporter,
      () =>
        createPagesFromCollectionBuilder(
          filePath,
          absolutePath,
          actions,
          graphql,
          reporter
        )
    )

    return
  }

  // 2. Get the nodes out of the data. We very much expect data to come back in a known shape:
  //    data = { [key: string]: { nodes: Array<ACTUAL_DATA> } | { group: Array<{ field: string; fieldValue: string; totalCount: number }> } }
  //    Meaning: Either get normal nodes back or the result of group

  // 2.a Get the values from data
  //     Result: { nodes: Array<ACTUAL_DATA> } | { group: Array< field: string; fieldValue: string; totalCount: number }> }
  // 2.b Set nodes (normal query and group query are both arrays of objects)
  const nodes = Object.values(Object.values(data)[0])[0] as Array<
    Record<string, unknown>
  >
  console.log({ nodes })

  if (nodes) {
    reporter.verbose(
      `   PageCreator: Creating ${nodes.length} page${
        nodes.length > 1 ? `s` : ``
      } from ${filePath}`
    )
  }

  let derivePathErrors = 0

  // 3. Loop through each node and create the page, also save the path it creates to pass to the watcher
  //    the watcher will use this data to delete the pages if the query changes significantly.
  const paths = nodes.map(node => {
    // URL path for the component and node
    const { derivedPath, errors } = derivePath(filePath, node, reporter)
    const path = createPath(derivedPath)
    // Params is supplied to the FE component on props.params
    const params = getCollectionRouteParams(createPath(filePath), path)
    // nodeParams is fed to the graphql query for the component
    const nodeParams = reverseLookupParams(node, absolutePath)
    // matchPath is an optional value. It's used if someone does a path like `{foo}/[bar].js`
    const matchPath = getMatchPath(path)

    actions.createPage({
      path: path,
      matchPath,
      component: absolutePath,
      context: {
        ...nodeParams,
        __params: params,
      },
    })

    derivePathErrors += errors

    return path
  })

  if (derivePathErrors > 0) {
    reporter.panicOnBuild({
      id: prefixId(CODES.GeneratePath),
      context: {
        sourceMessage: `Could not find a value in the node for ${filePath}. Please make sure that the syntax is correct and supported.`,
      },
    })
  }

  watchCollectionBuilder(
    absolutePath,
    queryString,
    paths,
    actions,
    reporter,
    () =>
      createPagesFromCollectionBuilder(
        filePath,
        absolutePath,
        actions,
        graphql,
        reporter
      )
  )
}
