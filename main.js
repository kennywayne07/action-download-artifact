const core = require('@actions/core')
const github = require('@actions/github')
const AdmZip = require('adm-zip')
const filesize = require('filesize')
const pathname = require('path')
const fs = require('fs')

async function main() {
    try {
        const token = core.getInput("github_token", { required: true })
        const workflow = core.getInput("workflow", { required: true })
        const [owner, repo] = core.getInput("repo", { required: true }).split("/")
        const path = core.getInput("path", { required: true })
        const name = core.getInput("name")
        let workflowConclusion = core.getInput("workflow_conclusion")
        let pr = core.getInput("pr")
        let commit = core.getInput("commit")
        let branch = core.getInput("branch")
        let event = core.getInput("event")
        let runID = core.getInput("run_id")
        let runNumber = core.getInput("run_number")
        let checkArtifacts = core.getInput("check_artifacts")
        let searchArtifacts = core.getInput("search_artifacts")

        const client = github.getOctokit(token)
        
        //console.log("==> Client:", core.info(JSON.stringify(client)))
        //const {
        //    data: { login },
        //} = await client.rest.users.getAuthenticated()
        //console.log("Hello, %s", login)
        //console.log("List Workflows")
        const workflowList = await client.rest.actions.listRepoWorkflows({
          owner: owner,
          repo: repo,
        })
        //console.log(workflowList.data.workflows)
        const workflow_id = workflowList.data.workflows.find(item => item.name === workflow).id
        console.log("==> workflow_id", workflow_id)
        //console.log("Get Workflow")
        //const workflowResult = await client.rest.actions.getWorkflow({
        //  owner: owner,
        //  repo: repo,
        //  workflow_id: workflow,
        //})
        //console.log("List Workflow Runs")
        //const workflowRun = await client.rest.actions.listWorkflowRuns({
        //  owner: owner,
        //  repo: repo,
        //  workflow_id: workflow,
        //  per_page: 1,
        //})

        console.log("==> Workflow:", workflow)

        console.log("==> Repo:", owner + "/" + repo)

        console.log("==> Conclusion:", workflowConclusion)

        if (pr) {
            console.log("==> PR:", pr)

            const pull = await client.pulls.get({
                owner: owner,
                repo: repo,
                pull_number: pr,
            })
            commit = pull.data.head.sha
            //branch = pull.data.head.ref
        }

        if (commit) {
            console.log("==> Commit:", commit)
        }

        if (branch) {
            branch = branch.replace(/^refs\/heads\//, "")
            console.log("==> Branch:", branch)
        }

        if (event) {
            console.log("==> Event:", event)
        }

        if (runNumber) {
            console.log("==> RunNumber:", runNumber)
        }

        if (!runID) {
            console.log("==> Begin test")
            for await (const runs of client.paginate.iterator(client.actions.listWorkflowRuns, {
                owner: owner,
                repo: repo,
                workflow_id: workflow_id,
                ...(branch ? { branch } : {}),
                ...(event ? { event } : {}),
            }
            )) {
                //console.log("==> Test")
                //console.log("==> WorkflowRuns:", core.info(JSON.stringify(runs.data)))
                //console.log("==> LessWorkflowRuns:" , core.info(JSON.stringify(runs.data.find(item => item.name === workflow))))
                function sort_by_key(array, key)
                {
                  return array.sort(function(b, a)
                  {
                    var x = a[key]; var y = b[key];
                    return ((x < y) ? -1 : ((x > y) ? 1 : 0));
                  });
                }
                var newRunsData = sort_by_key(runs.data, 'run_number');
                //console.log("==> NewRunsData:" , core.info(JSON.stringify(newRunsData)))
                for (const run of newRunsData) {
                    console.log("==> Run check")
                    if (commit && run.head_sha != commit) {
                        console.log("==> Commit check")
                        continue
                    }
                    if (runNumber && run.run_number != runNumber) {
                        console.log("==> Run Number check")
                        continue
                    }
                    if (workflowConclusion && (workflowConclusion != run.conclusion && workflowConclusion != run.status)) {
                        console.log("==> Workflow Conclusion check")
                        continue
                    }
                    if (checkArtifacts || searchArtifacts) {
                        console.log("==> Check/SearchArftifacts")
                        let artifacts = await client.actions.listWorkflowRunArtifacts({
                            owner: owner,
                            repo: repo,
                            run_id: run.id,
                        })
                        if (artifacts.data.artifacts.length == 0) {
                            console.log("==> Length check")
                            continue
                        }
                        if (searchArtifacts) {
                            const artifact = artifacts.data.artifacts.find((artifact) => {
                                return artifact.name == name
                            })
                            if (!artifact) {
                                console.log("==> Artifact check")
                                continue
                            }
                        }
                    }
                    runID = run.id
                    break
                }
                if (runID) {
                    break
                }
            }
        }

        if (runID) {
            console.log("==> RunID:", runID)
        } else {
            throw new Error("no matching workflow run found")
        }

        let artifacts = await client.paginate(client.actions.listWorkflowRunArtifacts, {
            owner: owner,
            repo: repo,
            run_id: runID,
        })

        // One artifact or all if `name` input is not specified.
        if (name) {
            artifacts = artifacts.filter((artifact) => {
                return artifact.name == name
            })
        }

        if (artifacts.length == 0)
            throw new Error("no artifacts found")

        for (const artifact of artifacts) {
            console.log("==> Artifact:", artifact.id)

            const size = filesize(artifact.size_in_bytes, { base: 10 })

            console.log(`==> Downloading: ${artifact.name}.zip (${size})`)

            const zip = await client.actions.downloadArtifact({
                owner: owner,
                repo: repo,
                artifact_id: artifact.id,
                archive_format: "zip",
            })

            const dir = name ? path : pathname.join(path, artifact.name)

            fs.mkdirSync(dir, { recursive: true })

            const adm = new AdmZip(Buffer.from(zip.data))

            adm.getEntries().forEach((entry) => {
                const action = entry.isDirectory ? "creating" : "inflating"
                const filepath = pathname.join(dir, entry.entryName)

                console.log(`  ${action}: ${filepath}`)
            })

            adm.extractAllTo(dir, true)
        }
    } catch (error) {
        core.setOutput("error_message", error.message)
        core.setFailed(error.message)
    }
}

main()

