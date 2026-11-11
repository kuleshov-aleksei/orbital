package chatmedia

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Config configures the S3 MediaStore.
type S3Config struct {
	// Endpoint is how the backend reaches S3; PublicEndpoint is signed into
	// presigned URLs (browsers must reach it).
	Endpoint, PublicEndpoint string
	Bucket, Region           string
	AccessKey, SecretKey     string
}

// S3Store is the production MediaStore (Garage: path-style addressing, no
// optional checksums).
type S3Store struct {
	client  *s3.Client
	presign *s3.PresignClient
	bucket  string
}

func newS3Client(endpoint string, cfg S3Config) *s3.Client {
	return s3.New(s3.Options{
		Region:                     cfg.Region,
		BaseEndpoint:               aws.String(endpoint),
		UsePathStyle:               true,
		Credentials:                aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, "")),
		RequestChecksumCalculation: aws.RequestChecksumCalculationWhenRequired,
		ResponseChecksumValidation: aws.ResponseChecksumValidationWhenRequired,
	})
}

// NewS3Store creates the S3 MediaStore.
func NewS3Store(cfg S3Config) (MediaStore, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" || cfg.AccessKey == "" || cfg.SecretKey == "" {
		return nil, errors.New("chat media: S3 endpoint, bucket and keys are required")
	}
	public := cfg.PublicEndpoint
	if public == "" {
		public = cfg.Endpoint
	}
	return &S3Store{
		client:  newS3Client(cfg.Endpoint, cfg),
		presign: s3.NewPresignClient(newS3Client(public, cfg)),
		bucket:  cfg.Bucket,
	}, nil
}

func (s *S3Store) Put(ctx context.Context, key string, body io.ReadSeeker, size int64, contentType string) error {
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(s.bucket),
		Key:           aws.String(key),
		Body:          body,
		ContentLength: aws.Int64(size),
		ContentType:   aws.String(contentType),
		CacheControl:  aws.String("private, max-age=31536000, immutable"),
	})
	return err
}

// Delete removes objects one by one (DeleteObjects needs a checksum header
// that S3-compatible stores do not all accept). S3 deletes are idempotent.
func (s *S3Store) Delete(ctx context.Context, keys []string) error {
	for _, key := range keys {
		if _, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
			Bucket: aws.String(s.bucket), Key: aws.String(key),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *S3Store) PresignGet(ctx context.Context, key string, ttl time.Duration, disposition string) (string, error) {
	in := &s3.GetObjectInput{Bucket: aws.String(s.bucket), Key: aws.String(key)}
	if disposition != "" {
		in.ResponseContentDisposition = aws.String(disposition)
	}
	req, err := s.presign.PresignGetObject(ctx, in, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
