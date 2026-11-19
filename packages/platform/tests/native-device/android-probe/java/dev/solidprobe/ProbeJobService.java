package dev.solidprobe;

import android.app.job.JobParameters;
import android.app.job.JobService;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

/** The probe's background job: leaves a file the driver looks for. */
public class ProbeJobService extends JobService {
    @Override
    public boolean onStartJob(JobParameters params) {
        File directory = new File(getFilesDir(), "probe");
        directory.mkdirs();
        try (FileWriter writer = new FileWriter(new File(directory, "job-ran.json"))) {
            writer.write("{\"ok\":true,\"value\":{\"jobId\":" + params.getJobId() + "}}");
        } catch (IOException error) {
            throw new RuntimeException(error);
        }
        return false;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return false;
    }
}
