// Define nodejs modules we'll need.
const {
  readdirSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
} = require('fs')
const { createInterface } = require('readline')
const url = require('url')
const path = require('path')
const stream = require('stream')
const https = require('https')
const { request } = require('http')

// Define some configuration constants our app requires.
const sourceDirectory = 'data'
const imageOutputDirectory = 'image-output'
const allowedExtensions = ['.csv'] // Array of String filetypes we want to look inside.
const urlRegex = /(https?:\/\/cdn.discordapp.com\/attachments[^\s]+(.png|.gif|.jpg|.jpeg|.bmp))/gi // Regex/Regular Expression that we expect to find.

// Define 'container' constants to hold data we find.
const filePaths = []
const imageURLs = []
const failedDownloads = []
const downloadTimeout = 1000

// Creates (unique enough) IDs. Using Math.random isnt guaranteed to be unique, but in our case it shouldn't matter.
// Outputs a string similar to 0d87c0c7-9d7f-4f85-9bd3-7079ff2e02db that we'll use to prepend to filenames in case there are duplicates.
// (UUID = Universally Unique IDs)
const createUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Accepts an array of dirent (directory entities - things that exist within a directory - files/folders)
// Returns an array of directory names as strings
const getDirectories = (entities) =>
  entities
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => {
      console.log(dirent.name)
      console.log(imageOutputDirectory)
      return dirent.name
    })

// Accepts an array of dirent (directory entities - things that exist within a directory - files/folders)
// Returns an array of file names as strings
const getFiles = (entities) =>
  entities
    .filter(
      (dirent) => !dirent.isDirectory() && allowedExtensions.includes(path.extname(dirent.name))
    )
    .map((dirent) => dirent.name)

// Recursively looks inside a directory and returns all contents as an array of dirent (directory entities - things that exist within a directory - files/folders)
const getFilePaths = (dir) => {
  console.log(`Reading ${dir}`)
  const entities = readdirSync(path.join('./', dir), { withFileTypes: true })
  getFiles(entities).forEach((file) => filePaths.push(path.join(dir, file)))
  getDirectories(entities).forEach((d) => getFilePaths(path.join(dir, d)))
  console.log(filePaths)
}

// Accepts a string of a file that includes the path.
// Opens the file and creates a stream/allows us to do something with the contents.
// Returns a Promise - an asynchronous 'task' which can be resolved (success) or reject(ed) (failed)
const searchFile = (file) => {
  return new Promise((resolve) => {
    console.log(`Searching: ${file}`)
    const inStream = createReadStream(file)
    const outStream = new stream()
    const readline = createInterface(inStream, outStream)

    // Read the file line by line
    readline.on('line', function (line) {
      // Check if there is actually a line (not the end of the file) and that the line contains something that resembles the URL regex we defined
      if (line && line.search(urlRegex) >= 0) {
        // Grab each of the matching URLs as an array (we're assuming there can be more than one per line)
        const urls = line.match(urlRegex)
        // Then push (add) the URLs to the global constant where we store the URLs
        imageURLs.push(...urls)
      }
    })

    // When we're finished reading the file
    readline.on('close', function () {
      // Let the promise know we successfully finished the task
      resolve()
    })
  })
}

// Asynchonously go through all files and search them for urls
const getImageUrls = async () => Promise.all(filePaths.map(async (file) => searchFile(file)))

const removeFromFailed = (url) => {
  const index = failedDownloads.findIndex((element) => element === url)
  failedDownloads.splice(index, 1)
}

const addToFailed = (url) => {
  failedDownloads.push(url)
}

const deleteFile = (path) => {
  try {
    unlinkSync(path)
    console.log(`**SUCCESS** (Clean up failed file) ${path}`)
  } catch (error) {
    console.error(`**ERROR** [deleteFile] (${error.message}) ${path}`)
  }
}

// Download the image to output directory
const downloadImage = (imageUrl) => {
  return new Promise((resolve, reject) => {
    try {
      const filename = url.parse(imageUrl).pathname.split('/').pop()
      const request = https.get(imageUrl, { timeout: 1000 })
      request.setTimeout(10000, () => {
        console.log('close connection')
        request.destroy()
      })
      request.once('response', (response) => {
        const filePath = path.join(imageOutputDirectory, `${createUUID()}_${filename}`)
        const outFile = createWriteStream(filePath, { autoClose: false })

        response.pipe(outFile)

        outFile.on('finish', () => {
          outFile.close()
        })

        outFile.on('error', (error) => {
          console.log(`**ERROR** [response on error event] (${error.message}) ${filename}`)
          outFile.close()
          addToFailed(imageUrl)
          deleteFile(filePath)
        })

        const timeout = setTimeout(() => {
          console.log('close connection')
          request.destroy()
          outFile.close()
          addToFailed(imageUrl)
          deleteFile(filePath)
          reject(new Error(`**FAILED** [setTimeout within response] (Timed Out) ${imageUrl} `))
        }, downloadTimeout)

        response.on('end', () => {
          clearTimeout(timeout)
          removeFromFailed(imageUrl)
          console.log(`**SUCCESS** (Download Image) ${filename}`)
          resolve()
        })

        response.on('error', (error) => {
          console.log(`**ERROR** (GET ${imageUrl}) ${error.message}`)
          reject(error)
        })
      })
      request.on('timeout', () => {
        console.log(`**TIME OUT** [request timeout event]`)
      })
      request.on('error', (error) => {
        console.log(JSON.stringify(request, null, 2))
        console.log(
          `**ERROR** [request error event] (${error.code} - ${error.message}) ${imageUrl}`
        )
        console.log(error.stack)
      })
    } catch (error) {
      console.log(
        `**ERROR** [try/catch within downloadImage promise] (${error.message}) ${imageUrl}`
      )
    }
  })
}

// Check if image output directory exists, if not, create it.
const makeOutputDirectory = () => {
  if (!existsSync(imageOutputDirectory)) {
    console.log(`${imageOutputDirectory} does not exist. Creating.`)
    mkdirSync(imageOutputDirectory)
  } else {
    console.log(`${imageOutputDirectory} exists.`)
  }
}

// Invoke the above functions within an IIFE to make magic happen.
// IIFE (Immediately Invoked Function Expression) - Silly, but required to use async/await (for asynchronous code) in global scope
// Defining the function we want to invoke as an anonymous function within the first pair (). Second empty pair () invokes the function.
;(async () => {
  console.log('Getting file paths...')
  // Synchronously populate the global filePaths array with files & paths to files that we want to search
  getFilePaths(sourceDirectory)
  // Asynchronously look through each file for URLs and wait until finished
  console.log('Searching files for urls...')
  await getImageUrls()
  // Create output directy if needed
  makeOutputDirectory()
  // Go through all the URLs and download them
  for (const imageUrl of imageURLs) {
    let successful = false
    while (!successful) {
      try {
        await downloadImage(imageUrl)
        successful = true
      } catch (error) {
        console.log(`**Retrying** ${imageUrl}`)
        console.log(error.message)
      }
    }
  }
  console.log('Finished!')
})()
