package storagex

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscfg "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

type S3Backend struct {
	Client     *s3.Client
	Uploader   *manager.Uploader
	Presigner  *s3.PresignClient
	Bucket     string
	Prefix     string
	PublicBase string
}

type S3Options struct {
	Endpoint   string
	Region     string
	AccessKey  string
	SecretKey  string
	Bucket     string
	Prefix     string
	PublicBase string
	PathStyle  bool
}

func NewS3(ctx context.Context, o S3Options) (*S3Backend, error) {
	if o.Bucket == "" {
		return nil, errors.New("storagex: s3 bucket required")
	}

	if o.AccessKey != "" && o.SecretKey == "" {
		return nil, errors.New("storagex: s3 SecretKey required when AccessKey is set")
	}
	region := o.Region
	if region == "" {
		region = "us-east-1"
	}
	cfg, err := awscfg.LoadDefaultConfig(ctx, awscfg.WithRegion(region))
	if err != nil {
		return nil, err
	}
	if o.AccessKey != "" {
		cfg.Credentials = credentials.NewStaticCredentialsProvider(o.AccessKey, o.SecretKey, "")
	}
	client := s3.NewFromConfig(cfg, func(o2 *s3.Options) {
		if o.Endpoint != "" {
			o2.BaseEndpoint = aws.String(o.Endpoint)
		}
		o2.UsePathStyle = o.PathStyle
	})
	return &S3Backend{
		Client:     client,
		Uploader:   manager.NewUploader(client),
		Presigner:  s3.NewPresignClient(client),
		Bucket:     o.Bucket,
		Prefix:     o.Prefix,
		PublicBase: o.PublicBase,
	}, nil
}

func (s *S3Backend) fullKey(key string) (string, error) {
	if !ValidKey(key) {
		return "", errors.New("storagex: invalid key")
	}
	return s.Prefix + key, nil
}

func mapS3Err(err error) error {
	if err == nil {
		return nil
	}
	var nsk *types.NoSuchKey
	if errors.As(err, &nsk) {
		return os.ErrNotExist
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		if code := apiErr.ErrorCode(); code == "NoSuchKey" || code == "NotFound" {
			return os.ErrNotExist
		}
	}
	return err
}

func (s *S3Backend) Put(ctx context.Context, key, contentType string, r io.Reader) (Object, error) {
	fk, err := s.fullKey(key)
	if err != nil {
		return Object{}, err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	h := sha256.New()
	tee := io.TeeReader(r, h)
	_, err = s.Uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: aws.String(s.Bucket), Key: aws.String(fk),
		ContentType:        aws.String(contentType),
		ContentDisposition: aws.String(dispositionFor(contentType)),
		Body:               io.NopCloser(tee),
	})
	if err != nil {
		return Object{}, err
	}

	return Object{Key: key, ContentType: contentType, SHA256: ""}, nil
}

func (s *S3Backend) Open(ctx context.Context, key string) (io.ReadCloser, Object, error) {
	fk, err := s.fullKey(key)
	if err != nil {
		return nil, Object{}, err
	}
	out, err := s.Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket), Key: aws.String(fk),
	})
	if err != nil {
		return nil, Object{}, mapS3Err(err)
	}
	ct := "application/octet-stream"
	if out.ContentType != nil {
		ct = *out.ContentType
	}
	var size int64
	if out.ContentLength != nil {
		size = *out.ContentLength
	}
	return out.Body, Object{Key: key, ContentType: ct, Size: size}, nil
}

func (s *S3Backend) Delete(ctx context.Context, key string) error {
	fk, err := s.fullKey(key)
	if err != nil {
		return err
	}
	_, err = s.Client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.Bucket), Key: aws.String(fk),
	})
	return err
}

const s3DeleteChunk = 1000

func (s *S3Backend) DeleteMulti(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	var errs []error
	for len(keys) > 0 {
		n := len(keys)
		if n > s3DeleteChunk {
			n = s3DeleteChunk
		}
		chunk := keys[:n]
		keys = keys[n:]
		objs := make([]types.ObjectIdentifier, 0, len(chunk))
		for _, k := range chunk {
			fk, err := s.fullKey(k)
			if err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", k, err))
				continue
			}
			objs = append(objs, types.ObjectIdentifier{Key: aws.String(fk)})
		}
		if len(objs) == 0 {
			continue
		}
		out, err := s.Client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(s.Bucket),
			Delete: &types.Delete{Objects: objs, Quiet: aws.Bool(true)},
		})
		if err != nil {
			errs = append(errs, err)
			continue
		}
		for _, e := range out.Errors {
			errs = append(errs, fmt.Errorf("%s: %s", aws.ToString(e.Key), aws.ToString(e.Message)))
		}
	}
	return errors.Join(errs...)
}

func (s *S3Backend) URL(key string) string {
	if s.PublicBase == "" {
		return ""
	}
	return s.PublicBase + "/" + s.Prefix + escapeKey(key)
}

const maxPresignTTL = 7 * 24 * time.Hour

func (s *S3Backend) Presign(ctx context.Context, key string, ttl time.Duration) (string, error) {

	if ttl <= 0 {
		return "", errors.New("storagex: presign ttl must be positive")
	}
	if ttl > maxPresignTTL {
		return "", fmt.Errorf("storagex: presign ttl %s exceeds the SigV4 maximum of 7d", ttl)
	}
	fk, err := s.fullKey(key)
	if err != nil {
		return "", err
	}
	req, err := s.Presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.Bucket), Key: aws.String(fk),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}
