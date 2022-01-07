// Define nodejs modules we'll need.
const { readdirSync, createReadStream, createWriteStream, existsSync, mkdirSync } = require('fs')
const { createInterface } = require('readline')
const url = require('url')
const path = require('path')
const stream = require('stream')
const https = require('https')

// Define some configuration constants our app requires.
const sourceDirectory = './'
const imageOutputDirectory = 'image-output'
const allowedExtensions = ['.csv'] // Array of String filetypes we want to look inside.
const urlRegex = /(https?:\/\/cdn.discordapp.com\/attachments[^\s]+)/gi // Regex/Regular Expression that we expect to find.

// Define 'container' constants to hold data we find.
const filePaths = []
const imageURLs = []

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
  entities.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name)

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
  const entities = readdirSync(dir, { withFileTypes: true })
  getFiles(entities).forEach((file) => filePaths.push(path.join(dir, file)))
  getDirectories(entities).forEach((d) => getFilePaths(path.join(dir, d)))
}

// Accepts a string of a file that includes the path.
// Opens the file and creates a stream/allows us to do something with the contents.
// Returns a Promise - an asynchronous 'task' which can be resolved (success) or reject(ed) (failed)
const searchFile = (file) => {
  return new Promise((resolve) => {
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

// Download the image to output directory
const downloadImage = (imageUrl) => {
  const filename = url.parse(imageUrl).pathname.split('/').pop()
  https.get(imageUrl, (response) =>
    response.pipe(createWriteStream(path.join(imageOutputDirectory, `${createUUID()}_${filename}`)))
  )
}

// Check if image output directory exists, if not, create it.
const makeOutputDirectory = () => {
  const dir = path.join(sourceDirectory, imageOutputDirectory)
  if (!existsSync(dir)) {
    mkdirSync(dir)
  }
}

// Invoke the above functions within an IIFE to make magic happen.
// IIFE (Immediately Invoked Function Expression) - Silly, but required to use async/await (for asynchronous code) in global scope
// Defining the function we want to invoke as an anonymous function within the first pair (). Second empty pair () invokes the function.
;(async () => {
  // Synchronously populate the global filePaths array with files & paths to files that we want to search
  getFilePaths(sourceDirectory)
  // Asynchronously look through each file for URLs and wait until finished
  await getImageUrls()
  // Create output directy if needed
  makeOutputDirectory()
  // Go through all the URLs and download them
  for (const url of imageURLs) {
    downloadImage(url)
  }
})()
