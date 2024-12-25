const express = require('express');
const multer = require('multer');
const { PythonShell } = require('python-shell');
const path = require('path');
const fs = require('fs');

module.exports = (io) => {
    const router = express.Router();

    // Set up Multer for file uploads
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(__dirname, '../uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname}`);
        },
    });
    const upload = multer({ storage });

    // Upload and process video
    router.post('/upload', upload.single('video'), async (req, res) => {
        try {
            if (!req.file || !req.file.path) {
                return res.status(400).send({ error: 'No file uploaded or invalid file.' });
            }

            const videoPath = path.resolve(req.file.path);
            console.log('Uploaded video path:', videoPath);

            const options = {
                mode: 'text',
                pythonOptions: ['-u'],
                scriptPath: path.join(__dirname, '..'),
                args: [videoPath],
            };

            io.emit('processingUpdate', { progress: 0, message: 'Processing started.' });

            const pyshell = new PythonShell('processVideo.py', options);

            pyshell.on('message', (message) => {
                console.log('Python script message:', message);
                try {
                    const update = JSON.parse(message);
                    if (update.progress) {
                        io.emit('processingUpdate', update);
                    }
                } catch (err) {
                    console.error('Failed to parse progress update:', err);
                }
            });

            pyshell.on('stderr', (stderr) => {
                console.error('Python script error output:', stderr);
            });

            pyshell.end((err) => {
                if (err) {
                    console.error('Error during video processing:', err);
                    io.emit('processingUpdate', { progress: 100, message: 'Processing failed.' });
                    return res.status(500).send({ error: 'Video processing failed!' });
                }

                console.log('Python script finished successfully.');

                // Retrieve processed video output
                try {
                    const output = JSON.parse(pyshell.receivedMessages[0]);
                    const processedVideoPath = path.join(__dirname, '..', output.output_video);

                    const publicPath = processedVideoPath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/');
                    io.emit('processingUpdate', { progress: 100, message: 'Processing completed!' });

                    res.status(200).send({
                        message: 'Video uploaded and processed successfully!',
                        processedVideo: publicPath,
                    });
                } catch (parseError) {
                    console.error('Failed to parse Python script output:', parseError);
                    io.emit('processingUpdate', { progress: 100, message: 'Processing failed: Invalid output.' });
                    res.status(500).send({ error: 'Invalid output from Python script.' });
                }
            });
        } catch (error) {
            console.error('Error:', error);
            io.emit('processingUpdate', { progress: 100, message: 'An error occurred during processing.' });
            res.status(500).send({ error: 'An error occurred during video processing.' });
        }
    });

    // Serve processed video files
    router.get('/processed/:filename', (req, res) => {
        const filePath = path.join(__dirname, '..', 'videos', req.params.filename);
        if (fs.existsSync(filePath)) {
            res.type('video/mp4').sendFile(filePath);
        } else {
            res.status(404).send({ error: 'File not found.' });
        }
    });

    return router;
};
